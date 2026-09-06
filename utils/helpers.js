const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');

function parseBalance(v) {
  if (v == null) return 0;
  const n = parseFloat(v.toString());
  return isNaN(n) ? 0 : n;
}

async function getCurrentBalance(userObjectId) {
  const last = await Transaction.findOne({ user: userObjectId, status: 'success' }).sort({ createdAt: -1 }).lean();
  if (last && last.balanceAfter != null) return parseBalance(last.balanceAfter);
  return 0;
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
  getCurrentBalance,
  getNextSequence,
  formatTrnId,
  formatPayinId,
  formatPayoutId,
};
