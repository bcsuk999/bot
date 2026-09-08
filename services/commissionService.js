const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Commission = require('../models/Commission');
const { getCommissionConfig } = require('./configService');
const {
  parseBalance,
  getCurrentBalance,
  generateOrderId,
} = require('../utils/helpers');
const logger = require('../utils/logger');

async function creditCommission({ userid, payinId, depositAmount, currency }) {
  try {
    const config = await getCommissionConfig();
    if (!config.isActive || config.commissionPercentage <= 0) return null;

    const referee = await User.findOne({ userid }).select('_id userid referredBy status').lean();
    if (!referee || !referee.referredBy) return null;

    const referrer = await User.findOne({ _id: referee.referredBy, status: 'active' }).select('_id userid').lean();
    if (!referrer) return null;

    const amount = parseBalance(depositAmount);
    if (amount <= 0) return null;

    const percentage = Number(config.commissionPercentage);
    const commissionAmount = Number((amount * percentage / 100).toFixed(2));
    if (commissionAmount <= 0) return null;

    const currentBalance = await getCurrentBalance(referrer._id);
    const newBalance = currentBalance + commissionAmount;

    const commissionId = generateOrderId('COMM');
    const trnId = generateOrderId('TXN');

    const transaction = await Transaction.create({
      trnId,
      user: referrer._id,
      userid: referrer.userid,
      amount: commissionAmount,
      type: 'credit',
      note: 'payin',
      remark: `Referral commission (${percentage}%) from ${userid}`,
      balanceAfter: newBalance,
      status: 'success',
      referenceId: payinId,
      network: currency === 'INR' ? 'INR' : null,
      currency,
      creditedAmount: commissionAmount,
    });

    await Commission.create({
      commissionId,
      referrer: referrer._id,
      referee: referee._id,
      referrerUserid: referrer.userid,
      refereeUserid: referee.userid,
      payinId,
      depositAmount: amount,
      currency,
      commissionPercentage: percentage,
      commissionAmount,
      status: 'success',
      creditedAt: new Date(),
    });

    return { commissionId, commissionAmount, transaction };
  } catch (err) {
    logger.error({ err }, 'Commission credit error');
    return null;
  }
}

async function reverseCommission({ payinId, remark }) {
  try {
    const commissions = await Commission.find({ payinId, status: 'success' }).lean();
    if (!commissions.length) return null;

    const reversals = [];
    for (const c of commissions) {
      const amount = parseBalance(c.commissionAmount);
      if (amount <= 0) continue;

      const currentBalance = await getCurrentBalance(c.referrer);
      const newBalance = currentBalance - amount;

      const trnId = generateOrderId('TXN');

      await Transaction.create({
        trnId,
        user: c.referrer,
        userid: c.referrerUserid,
        amount,
        type: 'debit',
        note: 'reversal',
        remark: remark ? String(remark).trim() : `Reversal of commission ${c.commissionId}`,
        balanceAfter: newBalance,
        status: 'success',
        referenceId: c.payinId,
        network: c.currency === 'INR' ? 'INR' : null,
        currency: c.currency,
        creditedAmount: amount,
      });

      await Commission.updateOne({ _id: c._id }, { status: 'reversed' });
      reversals.push({ commissionId: c.commissionId, amount });
    }
    return reversals;
  } catch (err) {
    logger.error({ err }, 'Commission reversal error');
    return null;
  }
}

module.exports = { creditCommission, reverseCommission };