const mongoose = require('mongoose');
const TelegramGroup = require('../models/TelegramGroup');
const BotOrder = require('../models/BotOrder');
const BotTransaction = require('../models/BotTransaction');
const { parseBalance, generateOrderId } = require('../utils/helpers');
const { randomUid } = require('./bot/uid');
const logger = require('../utils/logger');

const UID_ALLOCATION_ATTEMPTS = 25;
const UID_SAVE_ATTEMPTS = 5;

function createApprovalError(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

function isDuplicateUid(err) {
  return err?.code === 11000 && /uid/i.test(String(err.message || ''));
}

/** Pick a 5-digit uid that is not already taken. */
async function allocateGroupUid() {
  for (let attempt = 0; attempt < UID_ALLOCATION_ATTEMPTS; attempt++) {
    const uid = randomUid();
    if (!(await TelegramGroup.exists({ uid }))) return uid;
  }
  const err = new Error('Unable to allocate a unique group uid');
  err.status = 503;
  throw err;
}

/**
 * Give an existing group a uid. Atomic so two concurrent requests cannot write
 * different codes; retries on the rare unique-index collision.
 */
async function assignGroupUid(group) {
  if (!group || group.uid) return group?.uid ?? null;

  for (let attempt = 0; attempt < UID_SAVE_ATTEMPTS; attempt++) {
    const uid = await allocateGroupUid();
    try {
      const updated = await TelegramGroup.findOneAndUpdate(
        { _id: group._id, $or: [{ uid: { $exists: false } }, { uid: null }, { uid: '' }] },
        { $set: { uid } },
        { new: true }
      );
      if (updated) {
        group.uid = updated.uid;
        return updated.uid;
      }
      // Another request beat us to it - use whatever is stored now.
      const fresh = await TelegramGroup.findById(group._id);
      if (fresh?.uid) {
        group.uid = fresh.uid;
        return fresh.uid;
      }
    } catch (err) {
      if (!isDuplicateUid(err)) throw err;
    }
  }

  const err = new Error('Unable to allocate a unique group uid');
  err.status = 503;
  throw err;
}

/**
 * Create (or refresh) the member record for a group.
 * Membership is keyed on groupId alone - there is no userid and no User doc.
 * `registeredBy` is audit-only. Every member gets a public 5-digit `uid`.
 */
async function registerGroup({ groupId, title, username, type, registeredBy, registeredByUsername }) {
  const existing = await TelegramGroup.findOne({ groupId: String(groupId) });

  if (existing) {
    // Backfill old rows first, including blocked groups, so support can find
    // any group by uid.
    if (!existing.uid) await assignGroupUid(existing);

    if (existing.status !== 'active') {
      return {
        group: existing,
        alreadyRegistered: false,
        blocked: true,
        status: existing.status,
      };
    }
    // Idempotent: refresh descriptive fields only, never a second member row.
    if (title != null) existing.title = title;
    if (username != null) existing.username = username;
    if (type != null) existing.type = type;
    await existing.save();
    return { group: existing, alreadyRegistered: true, blocked: false };
  }

  const base = {
    groupId: String(groupId),
    title: title || '',
    username: username || null,
    type: type || 'supergroup',
    status: 'active',
    registeredBy: registeredBy ?? null,
    registeredByUsername: registeredByUsername || '',
  };

  let group = null;
  for (let attempt = 0; attempt < UID_SAVE_ATTEMPTS; attempt++) {
    try {
      group = await TelegramGroup.create({ ...base, uid: await allocateGroupUid() });
      break;
    } catch (err) {
      if (!isDuplicateUid(err) || attempt === UID_SAVE_ATTEMPTS - 1) throw err;
    }
  }

  logger.info({ groupId: String(groupId), uid: group.uid }, 'bot: group registered as member');
  return { group, alreadyRegistered: false, blocked: false };
}

async function getGroupByGroupId(groupId) {
  if (groupId == null) return null;
  return TelegramGroup.findOne({ groupId: String(groupId) });
}

async function getGroupByUid(uid) {
  if (uid == null) return null;
  const value = String(uid).trim();
  if (!/^\d{5}$/.test(value)) return null;
  return TelegramGroup.findOne({ uid: value });
}

/** Resolve a path parameter that may be either a Telegram group id or a uid. */
async function resolveGroup(value) {
  if (value == null) return null;
  const key = String(value).trim();
  if (!key) return null;
  return (await getGroupByGroupId(key)) || (await getGroupByUid(key));
}

/** uid lookup for a page of ledger rows, so responses can show it. */
async function getGroupUids(groupObjectIds = []) {
  const ids = [...new Set((groupObjectIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await TelegramGroup.find({ _id: { $in: ids } })
    .select('_id uid')
    .lean();
  return new Map(rows.map((row) => [String(row._id), row.uid || null]));
}

/** One-off startup pass: give every pre-existing group a uid. */
async function backfillGroupUids() {
  const missing = await TelegramGroup.find({
    $or: [{ uid: { $exists: false } }, { uid: null }, { uid: '' }],
  }).select('_id uid');

  let updated = 0;
  for (const group of missing) {
    try {
      if (await assignGroupUid(group)) updated += 1;
    } catch (err) {
      logger.error({ groupId: group._id, err }, 'bot: failed to assign group uid');
    }
  }
  if (updated) logger.info({ updated }, 'bot: backfilled group uids');
  return { updated };
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

async function listGroups({ filter = {}, page = 1, limit = 20 } = {}) {
  const { pageNum, limitNum, skip } = require('../utils/helpers').getPagination(page, limit);
  const [rows, count] = await Promise.all([
    TelegramGroup.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
    TelegramGroup.countDocuments(filter),
  ]);
  return { groups: rows, count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) };
}

async function listTransactions({ filter = {}, page = 1, limit = 20 } = {}) {
  const { pageNum, limitNum, skip } = require('../utils/helpers').getPagination(page, limit);
  const [rows, count] = await Promise.all([
    BotTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
    BotTransaction.countDocuments(filter),
  ]);
  return { transactions: rows, count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum) };
}

/**
 * Change a group's moderation state. `remark` is mandatory for every change,
 * including unban, and every change is appended to `statusHistory`.
 */
async function setGroupStatus(groupId, status, { remark, changedBy } = {}) {
  if (!['active', 'banned', 'suspended'].includes(status)) {
    throw createApprovalError('status must be active, banned or suspended');
  }
  const trimmedRemark = remark == null ? '' : String(remark).trim();
  if (!trimmedRemark) {
    throw createApprovalError('remark is required for a status change');
  }

  const group = await resolveGroup(groupId);
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  if (!group.uid) await assignGroupUid(group);

  const changedAt = new Date();
  group.status = status;
  group.statusRemark = trimmedRemark;
  group.statusUpdatedAt = changedAt;
  group.statusUpdatedBy = changedBy ?? null;
  group.statusHistory.push({
    status,
    remark: trimmedRemark,
    changedBy: changedBy ?? null,
    changedAt,
  });
  await group.save();

  logger.info({ groupId: group.groupId, status, changedBy: changedBy ?? null }, 'bot: group status changed');
  return group;
}

module.exports = {
  registerGroup,
  getGroupByGroupId,
  getGroupByUid,
  resolveGroup,
  getGroupUids,
  backfillGroupUids,
  getActiveGroup,
  getGroupBalance,
  getGroupLedger,
  creditGroup,
  adjustGroup,
  listGroups,
  listTransactions,
  setGroupStatus,
};
