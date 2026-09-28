const mongoose = require('mongoose');
const TelegramGroup = require('../models/TelegramGroup');
const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const { parseBalance, generateOrderId } = require('../utils/helpers');
const logger = require('../utils/logger');

function createApprovalError(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

/**
 * Create (or refresh) the member record for a group.
 * Membership is keyed on groupId alone - there is no userid and no User doc.
 * `registeredBy` is audit-only.
 */
async function registerGroup({ groupId, title, username, type, registeredBy, registeredByUsername }) {
  const existing = await TelegramGroup.findOne({ groupId: String(groupId) });

  if (existing) {
    if (existing.status === 'banned') {
      return { group: existing, alreadyRegistered: false, blocked: true };
    }
    // Idempotent: refresh descriptive fields only, never a second member row.
    if (title != null) existing.title = title;
    if (username != null) existing.username = username;
    if (type != null) existing.type = type;
    await existing.save();
    return { group: existing, alreadyRegistered: true, blocked: false };
  }

  const group = await TelegramGroup.create({
    groupId: String(groupId),
    title: title || '',
    username: username || null,
    type: type || 'supergroup',
    status: 'active',
    registeredBy: registeredBy ?? null,
    registeredByUsername: registeredByUsername || '',
  });
  logger.info({ groupId: String(groupId) }, 'bot: group registered as member');
  return { group, alreadyRegistered: false, blocked: false };
}

async function getGroupByGroupId(groupId) {
  if (groupId == null) return null;
  return TelegramGroup.findOne({ groupId: String(groupId) });
}

/** Active member or null. Used by every group-scoped command. */
async function getActiveGroup(groupId) {
  const group = await getGroupByGroupId(groupId);
  if (!group || group.status !== 'active') return null;
  return group;
}

/**
 * Group balance = balanceAfter of the most recent success ledger row, else 0.
 * Mirrors helpers.getCurrentBalance but keyed on the group instead of a user.
 *
 * Pass `session` to read inside a transaction so the read is part of the same
 * snapshot as the write that follows it.
 */
async function getGroupBalance(groupObjectId, session) {
  const q = BotTransaction.findOne({ group: groupObjectId, status: 'success' })
    .sort({ createdAt: -1 })
    .lean();
  if (session) q.session(session);
  const last = await q;
  if (last && last.balanceAfter != null) return parseBalance(last.balanceAfter);
  return 0;
}

async function getGroupLedger(groupObjectId, limit = 20) {
  return BotTransaction.find({ group: groupObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean({ getters: true });
}

/**
 * Credit a group's balance for a settled deposit.
 *
 * No bonus and no commission: credited is always the order's face value, and this
 * is the ONLY path that grows a group balance from a payment.
 *
 * `session` is required for the payment path. Claiming the order and writing the
 * ledger must commit together, or a crash between them leaves an order marked
 * success that was never credited. The group document is also written here, which
 * is what makes two concurrent credits conflict and retry rather than both
 * computing the same balanceAfter from the same stale read.
 */
async function creditGroup(order, { remark, session } = {}) {
  if (!session) {
    throw new Error('creditGroup requires a transaction session');
  }

  const group = await TelegramGroup.findOne({ groupId: String(order.groupId) }).session(session);
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }

  const current = await getGroupBalance(group._id, session);
  const credited = parseBalance(order.receivedAmount ?? order.amount);
  const trnId = generateOrderId('BTXN');

  // Mongoose requires create() to receive an array to attach a session.
  const [transaction] = await BotTransaction.create(
    [
      {
        trnId,
        group: group._id,
        groupId: group.groupId,
        order: order._id,
        orderId: order.orderId,
        amount: credited,
        type: 'credit',
        note: 'deposit',
        balanceAfter: current + credited,
        status: 'success',
        remark: remark || '',
      },
    ],
    { session }
  );

  await TelegramGroup.updateOne(
    { _id: group._id },
    {
      $inc: { totalDeposits: 1, totalCredited: credited },
      $set: { lastActiveAt: new Date() },
    },
    { session }
  );

  logger.info({ groupId: group.groupId, orderId: order.orderId, trnId, credited }, 'bot: credited group deposit');
  return { transaction, balance: current + credited, credited };
}

/**
 * Manual credit/debit from the admin REST API. Always a ledger row with a
 * mandatory remark and createdBy audit trail. Rejects a negative resulting balance.
 *
 * Runs in a transaction so the balance read cannot race a concurrent deposit.
 */
async function adjustGroup(groupObjectId, { amount, type, remark, createdBy } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw createApprovalError('Invalid amount');
  }
  if (!['credit', 'debit'].includes(type)) {
    throw createApprovalError('type must be credit or debit');
  }
  if (!remark || !String(remark).trim()) {
    throw createApprovalError('remark is required for adjustments');
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const group = await TelegramGroup.findById(groupObjectId).session(session);
      if (!group) {
        const err = new Error('Group not found');
        err.status = 404;
        throw err;
      }

      const current = await getGroupBalance(group._id, session);
      const next = type === 'debit' ? current - value : current + value;
      if (next < 0) {
        throw createApprovalError(`Insufficient balance. Available: ${current}`);
      }

      const trnId = generateOrderId('BTXN');
      const [transaction] = await BotTransaction.create(
        [
          {
            trnId,
            group: group._id,
            groupId: group.groupId,
            order: null,
            orderId: null,
            amount: value,
            type,
            note: 'adjustment',
            balanceAfter: next,
            status: 'success',
            createdBy: createdBy ?? null,
            remark: String(remark).trim(),
          },
        ],
        { session }
      );

      result = { transaction, balance: next };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function listGroups({ status, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (status && ['active', 'banned'].includes(status)) filter.status = status;
  const { pageNum, limitNum, skip } = require('../utils/helpers').getPagination(page, limit);
  const [rows, count] = await Promise.all([
    TelegramGroup.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
    TelegramGroup.countDocuments(filter),
  ]);
  return { groups: rows, count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) };
}

async function setGroupStatus(groupId, status) {
  if (!['active', 'banned'].includes(status)) {
    throw createApprovalError('status must be active or banned');
  }
  const group = await getGroupByGroupId(groupId);
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  group.status = status;
  await group.save();
  return group;
}

module.exports = {
  registerGroup,
  getGroupByGroupId,
  getActiveGroup,
  getGroupBalance,
  getGroupLedger,
  creditGroup,
  adjustGroup,
  listGroups,
  setGroupStatus,
};
