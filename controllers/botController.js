const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const botGroupService = require('../services/botGroupService');
const { claimOrder } = require('./botWebhookController');
const { getGroupStats, getGroupOrderCounts } = require('../services/bot/stats');
const {
  buildGroupFilter,
  buildOrderFilter,
  buildTransactionFilter,
  buildMeta,
  echoFilters,
} = require('../services/bot/query');
const { getPagination, toNum } = require('../utils/helpers');
const { health } = require('../services/bot/client');
const logger = require('../utils/logger');

function fail(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ success: 'failed', msg: err.message });
  logger.error({ err }, 'bot controller error');
  return res.status(500).json({ success: 'failed', msg: fallback });
}

function serializeOrder(o) {
  return {
    orderId: o.orderId,
    groupId: o.groupId,
    amount: toNum(o.amount),
    receivedAmount: toNum(o.receivedAmount ?? o.amount),
    status: o.status,
    upiId: o.upiId,
    deepLink: o.deepLink,
    paymentLink: o.paymentLink,
    simplypayOrderNo: o.simplypayOrderNo,
    trnId: o.trnId,
    requestedBy: o.requestedBy,
    remark: o.remark,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
  };
}

function serializeGroup(g, balance) {
  return {
    groupId: g.groupId,
    title: g.title,
    username: g.username,
    type: g.type,
    status: g.status,
    statusRemark: g.statusRemark || '',
    statusUpdatedAt: g.statusUpdatedAt || null,
    statusUpdatedBy: g.statusUpdatedBy ?? null,
    balance,
    totalDeposits: g.totalDeposits,
    totalCredited: toNum(g.totalCredited),
    totalFailed: g.totalFailed,
    registeredBy: g.registeredBy,
    createdAt: g.createdAt,
    lastActiveAt: g.lastActiveAt,
  };
}

function serializeTransaction(t) {
  return {
    trnId: t.trnId,
    groupId: t.groupId,
    orderId: t.orderId,
    amount: toNum(t.amount),
    type: t.type,
    note: t.note,
    balanceAfter: toNum(t.balanceAfter),
    status: t.status,
    createdBy: t.createdBy ?? null,
    remark: t.remark || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// GET /api/bot/health - no auth, mirrors the existing root health check
exports.health = async (req, res) => {
  return res.json({ success: true, bot: health() });
};

// GET /api/bot/groups
// Filters: ?groupId=&title=&status=active|banned|suspended&from=&to=&page=&limit=
exports.listGroups = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildGroupFilter(req.query);
    const result = await botGroupService.listGroups({ filter, page, limit });

    const groups = await Promise.all(
      result.groups.map(async (g) => serializeGroup(g, await botGroupService.getGroupBalance(g._id)))
    );

    return res.json({
      success: true,
      msg: 'Bot groups fetched',
      data: groups,
      meta: buildMeta({ total: result.count, page: result.page, limit: result.limit }),
      filters: echoFilters(req.query, ['groupId', 'title', 'status', 'from', 'to']),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch bot groups');
  }
};

// GET /api/bot/groups/:groupId
exports.getGroup = async (req, res) => {
  try {
    const group = await botGroupService.getGroupByGroupId(req.params.groupId);
    if (!group) return res.status(404).json({ success: 'failed', msg: 'Group not found' });

    const [balance, counts, orders] = await Promise.all([
      botGroupService.getGroupBalance(group._id),
      getGroupOrderCounts(group._id),
      BotOrder.find({ group: group._id }).sort({ createdAt: -1 }).limit(10).lean({ getters: true }),
    ]);

    return res.json({
      success: true,
      data: {
        group: serializeGroup(group, balance),
        statusHistory: group.statusHistory || [],
        counts,
        recentOrders: orders.map(serializeOrder),
      },
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch group');
  }
};

async function changeGroupStatus(req, res, status) {
  try {
    const remark = req.body?.remark;
    const group = await botGroupService.setGroupStatus(req.params.groupId, status, {
      remark,
      changedBy: req.user?.userid ?? null,
    });

    const msg = status === 'banned' ? 'Group banned' : status === 'suspended' ? 'Group suspended' : 'Group unbanned';
    return res.json({
      success: true,
      msg,
      data: {
        groupId: group.groupId,
        status: group.status,
        remark: group.statusRemark,
        updatedAt: group.statusUpdatedAt,
        updatedBy: group.statusUpdatedBy,
      },
    });
  } catch (err) {
    return fail(res, err, 'Failed to update group status');
  }
}

// PATCH /api/bot/groups/:groupId/status  { status, remark }
exports.updateGroupStatus = async (req, res) => {
  return changeGroupStatus(req, res, req.body?.status);
};

// POST /api/bot/groups/:groupId/ban      { remark }
exports.banGroup = async (req, res) => changeGroupStatus(req, res, 'banned');

// POST /api/bot/groups/:groupId/suspend  { remark }
exports.suspendGroup = async (req, res) => changeGroupStatus(req, res, 'suspended');

// POST /api/bot/groups/:groupId/unban    { remark }
exports.unbanGroup = async (req, res) => changeGroupStatus(req, res, 'active');

// POST /api/bot/groups/:groupId/adjust
exports.adjustGroup = async (req, res) => {
  try {
    const group = await botGroupService.getGroupByGroupId(req.params.groupId);
    if (!group) return res.status(404).json({ success: 'failed', msg: 'Group not found' });

    const { amount, type, remark } = req.body;
    const result = await botGroupService.adjustGroup(group._id, {
      amount,
      type,
      remark,
      createdBy: req.user?.userid ?? null,
    });

    return res.status(201).json({
      success: true,
      msg: 'Balance adjusted',
      trnId: result.transaction.trnId,
      type,
      amount: toNum(result.transaction.amount),
      balance: result.balance,
    });
  } catch (err) {
    return fail(res, err, 'Failed to adjust balance');
  }
};

// GET /api/bot/orders
// Filters: ?orderId=&groupId=&status=&from=&to=&page=&limit=
exports.listOrders = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildOrderFilter(req.query);

    const { pageNum, limitNum, skip } = getPagination(page, limit);
    const [rows, count] = await Promise.all([
      BotOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      BotOrder.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      msg: 'Bot orders fetched',
      data: rows.map(serializeOrder),
      meta: buildMeta({ total: count, page: pageNum, limit: limitNum }),
      filters: echoFilters(req.query, ['orderId', 'groupId', 'status', 'from', 'to']),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch orders');
  }
};

// GET /api/bot/orders/:orderId
exports.getOrder = async (req, res) => {
  try {
    const order = await BotOrder.findOne({ orderId: req.params.orderId }).lean({ getters: true });
    if (!order) return res.status(404).json({ success: 'failed', msg: 'Order not found' });

    const transaction = order.trnId
      ? await BotTransaction.findOne({ trnId: order.trnId }).lean({ getters: true })
      : null;

    return res.json({
      success: true,
      msg: 'Bot order fetched',
      data: {
        order: serializeOrder(order),
        transaction: transaction ? serializeTransaction(transaction) : null,
      },
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch order');
  }
};

// GET /api/bot/transactions
// Filters: ?trnId=&orderId=&groupId=&type=credit|debit&note=&status=&from=&to=&page=&limit=
exports.listTransactions = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildTransactionFilter(req.query);
    const result = await botGroupService.listTransactions({ filter, page, limit });

    return res.json({
      success: true,
      msg: 'Bot transactions fetched',
      data: result.transactions.map(serializeTransaction),
      meta: buildMeta({ total: result.count, page: result.page, limit: result.limit }),
      filters: echoFilters(req.query, ['trnId', 'orderId', 'groupId', 'type', 'note', 'status', 'from', 'to']),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch transactions');
  }
};

// GET /api/bot/transactions/:trnId
exports.getTransaction = async (req, res) => {
  try {
    const transaction = await BotTransaction.findOne({ trnId: req.params.trnId }).lean({ getters: true });
    if (!transaction) return res.status(404).json({ success: 'failed', msg: 'Transaction not found' });

    return res.json({
      success: true,
      msg: 'Bot transaction fetched',
      data: serializeTransaction(transaction),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch transaction');
  }
};

// POST /api/bot/orders/:orderId/approve
// Uses the SAME atomic claim as the webhook, so manual approval and a gateway
// settlement can never both credit the same order.
exports.approveOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const peek = await BotOrder.findOne({ orderId }).select('status').lean();
    if (!peek) return res.status(404).json({ success: 'failed', msg: 'Order not found' });
    if (peek.status !== 'pending') {
      return res.status(400).json({ success: 'failed', msg: `Cannot approve, status is ${peek.status}` });
    }

    const order = await claimOrder(orderId, {
      status: 'success',
      paidAt: new Date(),
      remark: 'Manually approved by admin',
    });
    if (!order) {
      return res.status(409).json({ success: 'failed', msg: 'Order was already settled' });
    }

    const { transaction, credited, balance } = await botGroupService.creditGroup(order, {
      remark: `Manual approval ${order.orderId}`,
    });
    await BotOrder.updateOne({ _id: order._id }, { $set: { trnId: transaction.trnId } });

    return res.status(201).json({
      success: true,
      msg: 'Order approved and credited',
      orderId: order.orderId,
      credited,
      trnId: transaction.trnId,
      balance,
    });
  } catch (err) {
    return fail(res, err, 'Failed to approve order');
  }
};

// POST /api/bot/orders/:orderId/reject
exports.rejectOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const peek = await BotOrder.findOne({ orderId }).select('status').lean();
    if (!peek) return res.status(404).json({ success: 'failed', msg: 'Order not found' });
    if (peek.status !== 'pending') {
      return res.status(400).json({ success: 'failed', msg: `Cannot reject, status is ${peek.status}` });
    }

    const remark = req.body?.remark ? String(req.body.remark).trim() : 'Rejected by admin';
    const order = await claimOrder(orderId, { status: 'failed', remark });
    if (!order) {
      return res.status(409).json({ success: 'failed', msg: 'Order was already settled' });
    }

    return res.json({ success: true, msg: 'Order rejected', orderId: order.orderId });
  } catch (err) {
    return fail(res, err, 'Failed to reject order');
  }
};

// GET /api/bot/stats/:groupId?window=today|all
exports.getStats = async (req, res) => {
  try {
    const window = req.query.window === 'today' ? 'today' : 'all';
    const group = await botGroupService.getGroupByGroupId(req.params.groupId);
    if (!group) return res.status(404).json({ success: 'failed', msg: 'Group not found' });

    const [today, all, balance] = await Promise.all([
      getGroupStats(group._id, 'today'),
      getGroupStats(group._id, 'all'),
      botGroupService.getGroupBalance(group._id),
    ]);

    return res.json({
      success: true,
      groupId: group.groupId,
      window,
      today,
      all,
      balance,
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch stats');
  }
};
