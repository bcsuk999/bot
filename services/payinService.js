const Transaction = require('../models/Transaction');
const { getRateFor } = require('../controllers/adminExchangeController');
const { calculateBonus } = require('../controllers/adminBonusController');
const {
  parseBalance,
  getCurrentBalance,
  getUserObjectId,
  getNextSequence,
  formatTrnId,
} = require('../utils/helpers');

function createApprovalError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function approvePayin(payin, options = {}) {
  const { overrideRate, txHash, remark } = options;

  const userObjId = await getUserObjectId(payin.userid);
  if (!userObjId) throw createApprovalError('User not found for payin');

  const currentBalance = await getCurrentBalance(userObjId);
  const amount = parseBalance(payin.amount);
  const isInr = payin.currency === 'INR' || payin.network === 'SPAY';

  let rate = 1;
  let bonus = 0;
  if (isInr) {
    bonus = await calculateBonus(amount);
  } else if (overrideRate != null) {
    const pr = Number(overrideRate);
    if (!isFinite(pr) || pr <= 0) throw createApprovalError('Invalid exchangeRate');
    rate = pr;
  } else {
    rate = await getRateFor(payin.currency || 'USDT', payin.network || null);
  }

  const creditedAmount = isInr ? amount + bonus : amount * rate;
  const newBalance = currentBalance + creditedAmount;

  const seq = await getNextSequence('transactionId');
  const trnId = formatTrnId(seq);
  const defaultRemark = isInr
    ? bonus > 0 ? `INR deposit + ${bonus} bonus` : 'INR deposit'
    : `${payin.network} deposit`;

  const transaction = await Transaction.create({
    trnId,
    user: userObjId,
    userid: payin.userid,
    amount: isInr ? creditedAmount : amount,
    type: 'credit',
    note: 'payin',
    remark: remark ? String(remark).trim() : defaultRemark,
    balanceAfter: newBalance,
    status: 'success',
    referenceId: payin.payinId,
    network: isInr ? 'INR' : payin.network,
    currency: payin.currency,
    exchangeRate: rate,
    creditedAmount,
    txHash: txHash ? String(txHash).trim() : null,
  });

  payin.status = 'success';
  if (txHash) payin.txHash = String(txHash).trim();
  if (remark) payin.remark = String(remark).trim();
  payin.exchangeRate = rate;
  payin.creditedAmount = creditedAmount;
  if (isInr) {
    payin.bonusAmount = bonus;
    payin.receivedAmount = creditedAmount;
  }
  await payin.save();

  return transaction;
}

module.exports = { approvePayin };