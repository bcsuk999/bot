const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const botGroupService = require('../services/botGroupService');
const { claimOrder, settleSuccess, notifySuccess } = require('./botWebhookController');
const { getGroupStats, getGroupOrderCounts } = require('../services/bot/stats');
const {
  buildGroupFilter,
  buildOrderFilter,
  buildTransactionFilter,
  buildMeta,
  echoFilters,
  pickUid,
  applyGroupScope,
  applyCursor,
  parseCursor,
  encodeCursor,
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
    // 'MANUAL' marks an admin adjustment order; gateway deposits are 'SPAY'.
    network: o.network,
    gatewayOrderNo: o.gatewayOrderNo || null,
    // 'credit' for deposits and manual credits, 'debit' for a manual withdrawal.
    direction: o.direction || 'credit',
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
    uid: g.uid || null,
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

function serializeTransaction(t, groupUid = null) {
  return {
    trnId: t.trnId,
    groupId: t.groupId,
    uid: groupUid,
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
// Filters: ?groupId=&uid=&title=&status=active|banned|suspended&from=&to=&page=&limit=
exports.listGroups = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildGroupFilter(req.query);
    const cursor = parseCursor(req.query.cursor);
    const result = await botGroupService.listGroups({ filter, page, limit, cursor });

    // One aggregation for the whole page instead of one query per group.
    const balances = await botGroupService.getGroupBalances(result.groups.map((g) => g._id));
    const groups = result.groups.map((g) => serializeGroup(g, balances.get(String(g._id)) ?? 0));

    return res.json({
      success: true,
      msg: 'Bot groups fetched',
      data: groups,
      meta: { ...buildMeta({ total: result.count, page: result.page, limit: result.limit }), nextCursor: result.nextCursor ?? null },
      filters: echoFilters(req.query, ['groupId', 'uid', 'title', 'status', 'from', 'to']),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch bot groups');
  }
};

// GET /api/bot/groups/:groupId  (accepts a Telegram group id or a 5-digit uid)
exports.getGroup = async (req, res) => {
  try {
    const group = await botGroupService.resolveGroup(req.params.groupId);
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
        uid: group.uid || null,
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

// PATCH /api/bot/groups/:groupId/status  { status, remark }  (group id or uid)
exports.updateGroupStatus = async (req, res) => {
  return changeGroupStatus(req, res, req.body?.status);
};

// POST /api/bot/groups/:groupId/ban      { remark }
exports.banGroup = async (req, res) => changeGroupStatus(req, res, 'banned');

// POST /api/bot/groups/:groupId/suspend  { remark }
exports.suspendGroup = async (req, res) => changeGroupStatus(req, res, 'suspended');

// POST /api/bot/groups/:groupId/unban    { remark }
exports.unbanGroup = async (req, res) => changeGroupStatus(req, res, 'active');

// POST /api/bot/groups/:groupId/adjust  (accepts a group id or a 5-digit uid)
exports.adjustGroup = async (req, res) => {
  try {
    const group = await botGroupService.resolveGroup(req.params.groupId);
    if (!group) return res.status(404).json({ success: 'failed', msg: 'Group not found' });

    const { amount, type, remark } = req.body;
    const result = await botGroupService.adjustGroup(group._id, {
      amount,
      type,
      remark,
      createdBy: req.user?.userid ?? null,
    });

    // Same group notice as a settled deposit, built from the order the adjustment
    // just created. notifySuccess swallows send failures, so a group that has
    // blocked the bot can never turn a committed adjustment into an error.
    await notifySuccess(result.order, toNum(result.transaction.amount));

    return res.status(201).json({
      success: true,
      msg: 'Balance adjusted',
      groupId: group.groupId,
      uid: group.uid || null,
      orderId: result.order.orderId,
      trnId: result.transaction.trnId,
      type,
      amount: toNum(result.transaction.amount),
      balance: result.balance,
    });
  } catch (err) {
    return fail(res, err, 'Failed to adjust balance');
  }
};

/**
 * Resolve `?groupId` / `?uid` to a real group and scope a list query to it.
 *
 * Ledger and order rows store both the group ObjectId (`group`) and the
 * Telegram id as a string (`groupId`). Older rows can be missing one of the
 * two, so matching on either keeps every row for the group in the same list.
 *
 * A 5-digit `groupId` is accepted as a uid: the `/reg` reply shows `UID: 32045`
 * and support tends to paste that into the group-id box. Without this the
 * regex ran against the Telegram id and returned nothing.
 */
async function scopeByGroup(filter, query = {}) {
  const groupIdParam = query.groupId == null ? '' : String(query.groupId).trim();
  const uid = pickUid(query.uid);
  if (!groupIdParam && !uid) return { group: null };

  const group = await botGroupService.findGroupForFilter({ groupId: groupIdParam, uid });
  if (!group) return { group: null, notFoundUid: uid || null };

  applyGroupScope(filter, group);
  return { group };
}

// GET /api/bot/orders
// Filters: ?orderId=&groupId=&uid=&status=&from=&to=&page=&limit=&cursor=
exports.listOrders = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildOrderFilter(req.query);

    const { notFoundUid } = await scopeByGroup(filter, req.query);
    if (notFoundUid) {
      return res.status(404).json({ success: 'failed', msg: `Group not found for uid: ${notFoundUid}` });
    }

    const cursor = parseCursor(req.query.cursor);
    // Count the filtered set, not just the rows after the cursor.
    const countFilter = { ...filter };
    applyCursor(filter, cursor);

    const { pageNum: requestedPage, limitNum } = getPagination(page, limit);
    const pageNum = cursor ? 1 : requestedPage;
    const skip = cursor ? 0 : (requestedPage - 1) * limitNum;
    const [rows, count] = await Promise.all([
      BotOrder.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean({ getters: true }),
      BotOrder.countDocuments(countFilter),
    ]);
    const nextCursor = rows.length === limitNum ? encodeCursor(rows[rows.length - 1]) : null;

    return res.json({
      success: true,
      msg: 'Bot orders fetched',
      data: rows.map(serializeOrder),
      meta: { ...buildMeta({ total: count, page: pageNum, limit: limitNum }), nextCursor },
      filters: echoFilters(req.query, ['orderId', 'groupId', 'uid', 'status', 'from', 'to']),
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
    const uids = transaction
      ? await botGroupService.getGroupUids([transaction.group])
      : new Map();

    return res.json({
      success: true,
      msg: 'Bot order fetched',
      data: {
        order: serializeOrder(order),
        transaction: transaction
          ? serializeTransaction(transaction, uids.get(String(transaction.group)) || null)
          : null,
      },
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch order');
  }
};

// GET /api/bot/transactions
// Filters: ?trnId=&orderId=&groupId=&uid=&type=credit|debit&note=&status=&from=&to=&page=&limit=
exports.listTransactions = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = buildTransactionFilter(req.query);

    // uid belongs to the group, not the ledger row, so resolve it first. This
    // also covers a 5-digit uid pasted into ?groupId=.
    const { notFoundUid } = await scopeByGroup(filter, req.query);
    if (notFoundUid) {
      return res.status(404).json({ success: 'failed', msg: `Group not found for uid: ${notFoundUid}` });
    }

    const cursor = parseCursor(req.query.cursor);
    const result = await botGroupService.listTransactions({ filter, page, limit, cursor });
    const uids = await botGroupService.getGroupUids(result.transactions.map((t) => t.group));

    return res.json({
      success: true,
      msg: 'Bot transactions fetched',
      data: result.transactions.map((t) => serializeTransaction(t, uids.get(String(t.group)) || null)),
      meta: { ...buildMeta({ total: result.count, page: result.page, limit: result.limit }), nextCursor: result.nextCursor ?? null },
      filters: echoFilters(req.query, ['trnId', 'orderId', 'groupId', 'uid', 'type', 'note', 'status', 'from', 'to']),
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

    const uids = await botGroupService.getGroupUids([transaction.group]);

    return res.json({
      success: true,
      msg: 'Bot transaction fetched',
      data: serializeTransaction(transaction, uids.get(String(transaction.group)) || null),
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

    const settled = await settleSuccess(orderId, null, {
      orderRemark: 'Manually approved by admin',
      transactionRemark: `Manual approval ${orderId}`,
    });
    if (settled.action !== 'credited') {
      return res.status(409).json({ success: 'failed', msg: 'Order was already settled' });
    }

    await notifySuccess(settled.order, settled.credited);

    return res.status(201).json({
      success: true,
      msg: 'Order approved and credited',
      orderId: settled.order.orderId,
      credited: settled.credited,
      trnId: settled.trnId,
      balance: settled.balance,
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

// GET /api/bot/stats/:groupId?window=today|all  (accepts a group id or a 5-digit uid)
exports.getStats = async (req, res) => {
  try {
    const window = req.query.window === 'today' ? 'today' : 'all';
    const group = await botGroupService.resolveGroup(req.params.groupId);
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
