const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Counter = require('../models/Counter');

function parseBalance(v) {
  if (v == null) return 0;
  const n = parseFloat(v.toString());
  return isNaN(n) ? 0 : n;
}

function toNum(v) {
  if (v == null) return v;
  const n = typeof v === 'object' && v.toString ? parseFloat(v.toString()) : Number(v);
  return isNaN(n) ? v : n;
}

function serializeTransaction(t) {
  return {
    trnId: t.trnId,
    userid: t.userid,
    user: t.user,
    amount: toNum(t.amount),
    type: t.type,
    note: t.note,
    remark: t.remark,
    balanceAfter: toNum(t.balanceAfter),
    status: t.status,
    exchangeRate: toNum(t.exchangeRate),
    creditedAmount: toNum(t.creditedAmount),
    referenceId: t.referenceId,
    network: t.network,
    currency: t.currency,
    txHash: t.txHash,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function getPagination(page = 1, limit = 20, maxLimit = 100) {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), maxLimit);
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
}

async function getCurrentBalance(userObjectId) {
  const last = await Transaction.findOne({ user: userObjectId, status: 'success' }).sort({ createdAt: -1 }).lean();
  if (last && last.balanceAfter != null) return parseBalance(last.balanceAfter);
  return 0;
}

async function getUserObjectId(userid) {
  if (userid == null) return null;
  const u = await User.findOne({ userid }).select('_id').lean();
  return u ? u._id : null;
}

async function getNextSequence(name) {
  const c = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return c.seq;
}

function formatTrnId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TXN${ds}${String(seq).padStart(4, '0')}`;
}

function formatPayinId(seq, prefix = 'PAY') {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}${ds}${String(seq).padStart(4, '0')}`;
}

function formatPayoutId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `PAYOUT${ds}${String(seq).padStart(4, '0')}`;
}

module.exports = {
  parseBalance,
  toNum,
  serializeTransaction,
  getPagination,
  getCurrentBalance,
  getUserObjectId,
  getNextSequence,
  formatTrnId,
  formatPayinId,
  formatPayoutId,
};
