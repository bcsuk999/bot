const Transaction = require('../models/Transaction');
const User = require('../models/User');

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
  const row = {
    trnId: t.trnId,
    userid: t.userid,
    user: t.user,
    amount: toNum(t.amount),
    type: t.type,
    note: t.note,
    remark: t.remark,
    balanceAfter: toNum(t.balanceAfter),
    status: t.status,
    creditedAmount: toNum(t.creditedAmount),
    referenceId: t.referenceId,
    network: t.network,
    currency: t.currency,
    txHash: t.txHash,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  if (t.currency !== 'INR') row.exchangeRate = toNum(t.exchangeRate);
  return row;
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

// Time-based order ID: [prefix] + YYYYMMDD + HHMMSS + 9-digit nanosecond fraction.
// The nanosecond part makes collisions within the same second practically impossible,
// so no counter needed. Example (payin): P20260908093925967924200
function generateOrderId(prefix = '') {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ns = String(process.hrtime.bigint() % 1000000000n).padStart(9, '0');
  return `${prefix}${ymd}${hms}${ns}`;
}

module.exports = {
  parseBalance,
  toNum,
  serializeTransaction,
  getPagination,
  getCurrentBalance,
  getUserObjectId,
  generateOrderId,
};
