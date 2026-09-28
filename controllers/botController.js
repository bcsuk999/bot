const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const botGroupService = require('../services/botGroupService');
const { claimOrder } = require('./botWebhookController');
const { getGroupStats, getGroupOrderCounts } = require('../services/bot/stats');
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

// GET /api/bot/health - no auth, mirrors the existing root health check
exports.health = async (req, res) => {
  return res.json({ success: true, bot: health() });
};

// GET /api/bot/groups
exports.listGroups = async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const result = await botGroupService.listGroups({ status, page, limit });
    const groups = await Promise.all(
      result.groups.map(async (g) => ({
        groupId: g.groupId,
        title: g.title,
        username: g.username,
        type: g.type,
        status: g.status,
        balance: await botGroupService.getGroupBalance(g._id),
        totalDeposits: g.totalDeposits,
        totalFailed: g.totalFailed,
        registeredBy: g.registeredBy,
        createdAt: g.createdAt,
      }))
    );
    return res.json({
      success: true,
      msg: 'Bot groups fetched',
      count: result.count,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      groups,
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
      group: {
        groupId: group.groupId,
        title: group.title,
        username: group.username,
        type: group.type,
        status: group.status,
        balance,
        totalDeposits: group.totalDeposits,
        totalCredited: toNum(group.totalCredited),
        totalFailed: group.totalFailed,
        registeredBy: group.registeredBy,
        createdAt: group.createdAt,
        lastActiveAt: group.lastActiveAt,
      },
      counts,
      recentOrders: orders.map(serializeOrder),
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch group');
  }
};

// PATCH /api/bot/groups/:groupId/status
exports.updateGroupStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const group = await botGroupService.setGroupStatus(req.params.groupId, status);
    return res.json({ success: true, msg: 'Group status updated', groupId: group.groupId, status: group.status });
  } catch (err) {
    return fail(res, err, 'Failed to update group status');
  }
};

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
exports.listOrders = async (req, res) => {
  try {
    const { groupId, status, from, to, page, limit } = req.query;
    const filter = {};
    if (groupId) filter.groupId = String(groupId);
    if (status && ['pending', 'success', 'failed', 'expired', 'reversed'].includes(status)) filter.status = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const { pageNum, limitNum, skip } = getPagination(page, limit);
    const [rows, count] = await Promise.all([
      BotOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      BotOrder.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      msg: 'Bot orders fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      orders: rows.map(serializeOrder),
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
      order: serializeOrder(order),
      transaction: transaction
        ? { trnId: transaction.trnId, type: transaction.type, amount: toNum(transaction.amount), balanceAfter: toNum(transaction.balanceAfter), remark: transaction.remark }
        : null,
    });
  } catch (err) {
    return fail(res, err, 'Failed to fetch order');
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
