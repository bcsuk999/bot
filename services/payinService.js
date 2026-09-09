const Transaction = require('../models/Transaction');
const { getRateFor } = require('../controllers/adminExchangeController');
const { calculateBonus } = require('../controllers/adminBonusController');
const { creditCommission } = require('./commissionService');
const {
  parseBalance,
  getCurrentBalance,
  getUserObjectId,
  generateOrderId,
} = require('../utils/helpers');

function createApprovalError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function approvePayin(payin, options = {}) {
  const { txHash, remark } = options;

  const userObjId = await getUserObjectId(payin.userid);
  if (!userObjId) throw createApprovalError('User not found for payin');

  const currentBalance = await getCurrentBalance(userObjId);
  const amount = parseBalance(payin.amount);
  const isInr = payin.currency === 'INR' || payin.network === 'SPAY';

  let rate = 1;
  let bonus = 0;
  let creditedAmount;
  if (isInr) {
    rate = 1;
    bonus = payin.bonusAmount != null ? parseBalance(payin.bonusAmount) : await calculateBonus(amount);
    creditedAmount = payin.receivedAmount != null ? parseBalance(payin.receivedAmount) : amount + bonus;
  } else {
    rate = payin.exchangeRate != null ? parseBalance(payin.exchangeRate) : (await getRateFor(payin.currency || 'USDT', payin.network || null));
    creditedAmount = payin.receivedAmount != null ? parseBalance(payin.receivedAmount) : amount * rate;
  }

  if (!isFinite(rate) || rate <= 0) throw createApprovalError('Invalid exchange rate on payin');
  const newBalance = currentBalance + creditedAmount;

  const trnId = generateOrderId('TXN');
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
  payin.receivedAmount = creditedAmount;
  if (isInr) {
    payin.bonusAmount = bonus;
  }
  await payin.save();

  if (payin.commissionProcessed !== true) {
    await creditCommission({
      userid: payin.userid,
      payinId: payin.payinId,
      depositAmount: amount,
      currency: payin.currency || (isInr ? 'INR' : 'USDT'),
    });
    payin.commissionProcessed = true;
    await payin.save();
  }

  return transaction;
}

module.exports = { approvePayin };