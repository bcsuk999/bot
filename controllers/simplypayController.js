const Payin = require('../models/Payin');
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const User = require('../models/User');
const Bank = require('../models/Bank');
const simplypay = require('../services/simplypay');
const { calculateBonus } = require('./adminBonusController');

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
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
  return c.seq;
}

function formatPayinId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `FPAY${ds}${String(seq).padStart(4, '0')}`;
}

function formatTrnId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TXN${ds}${String(seq).padStart(4, '0')}`;
}

// User creates INR deposit via SimplyPay
exports.createPayin = async (req, res) => {
  try {
    const { amount, currency, network } = req.body;

    if (!amount) {
      return res.status(400).json({ success: 'failed', msg: 'amount is required' });
    }

    const parsedAmount = Number(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid amount' });
    }

    const payinSeq = await getNextSequence('payinId');
    const payinId = formatPayinId(payinSeq);

    const payin = await Payin.create({
      payinId,
      user: req.user.userId,
      userid: req.user.userid,
      currency: 'INR',
      amount: parsedAmount,
      network: 'SPAY',
      address: null,
      status: 'pending',
      transactionType: 'payin',
      requiredConfirmations: 0,
      remark: 'INR deposit via SimplyPay',
      exchangeRate: 1,
      creditedAmount: parsedAmount,
    });

    const user = await User.findById(req.user.userId).lean();

    const apiRes = await simplypay.createPaymentOrder({
      merOrderNo: payinId,
      amount: parsedAmount,
      attach: `deposit_${payinId}`,
      extra: {
        name: user?.mobile || 'User',
        email: `${user?.mobile || '9999999999'}@example.com`,
        mobile: user?.mobile || '',
      },
    });

    if (apiRes.code !== 0) {
      payin.status = 'failed';
      payin.remark = apiRes.msg || 'SimplyPay order failed';
      payin.failedAt = new Date();
      await payin.save();
      return res.status(400).json({ success: 'failed', msg: apiRes.msg || 'SimplyPay order failed' });
    }

    const bonus = await calculateBonus(parsedAmount);
    const receivedAmount = parsedAmount + bonus;

    return res.status(201).json({
      success: true,
      payinId,
      amount: parsedAmount,
      bonus,
      receivedAmount,
      currency: 'INR',
      paymentLink: apiRes.data?.params?.paymentLink || null,
      deepLink: apiRes.data?.params?.deepLink || null,
      orderNo: apiRes.data?.orderNo || null,
    });
  } catch (err) {
    console.error('simplypay createPayin error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to create payin' });
  }
};

// SimplyPay payin webhook callback (no auth - called by gateway)
exports.payinCallback = async (req, res) => {
  try {
    const body = req.body;

    if (!simplypay.verifySign(body)) {
      console.error('SimplyPay callback signature mismatch');
      return res.status(200).json({ success: true });
    }

    const { merOrderNo, orderStatus } = body.data || {};
    if (!merOrderNo) return res.status(200).json({ success: true });

    const payin = await Payin.findOne({ payinId: merOrderNo });
    if (!payin) return res.status(200).json({ success: true });

    if (payin.status !== 'pending') return res.status(200).json({ success: true });

    const SUCCESS_STATUSES = [2, 3];
    const FAILED_STATUSES = [-1, -2];

    if (SUCCESS_STATUSES.includes(orderStatus)) {
      const currentBalance = await getCurrentBalance(payin.user);
      const amount = parseBalance(payin.amount);
      const bonus = await calculateBonus(amount);
      const receivedAmount = amount + bonus;
      const newBalance = currentBalance + receivedAmount;

      const seq = await getNextSequence('transactionId');
      const trnId = formatTrnId(seq);

      await Transaction.create({
        trnId,
        user: payin.user,
        userid: payin.userid,
        amount: receivedAmount,
        type: 'credit',
        note: 'payin',
        remark: bonus > 0 ? `INR deposit via SimplyPay + ${bonus} bonus` : 'INR deposit via SimplyPay',
        balanceAfter: newBalance,
        status: 'success',
        referenceId: payin.payinId,
        network: 'INR',
        currency: 'INR',
        exchangeRate: 1,
        creditedAmount: receivedAmount,
      });

      payin.status = 'success';
      payin.completedAt = new Date();
      payin.detectedAmount = amount;
      payin.exchangeRate = 1;
      payin.creditedAmount = receivedAmount;
      payin.bonusAmount = bonus;
      payin.receivedAmount = receivedAmount;
      await payin.save();
    } else if (FAILED_STATUSES.includes(orderStatus)) {
      payin.status = 'failed';
      payin.failedAt = new Date();
      payin.remark = `SimplyPay status: ${orderStatus}`;
      await payin.save();
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SimplyPay payinCallback error:', err);
    return res.status(200).json({ success: true });
  }
};

// Admin process payout via SimplyPay
exports.processPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { payoutType, vpa, ifsc, account, name, email, mobile } = req.body;

    const payout = await Payout.findOne({ payoutId });
    if (!payout) return res.status(404).json({ success: 'failed', msg: 'Payout not found' });
    if (payout.status !== 'pending') return res.status(400).json({ success: 'failed', msg: `Cannot process, status is ${payout.status}` });

    const user = await User.findById(payout.user).lean();
    if (!user) return res.status(404).json({ success: 'failed', msg: 'User not found' });

    const extra = {
      payoutType: payoutType || 'UPI',
      name: name || user.mobile,
      email: email || '',
      mobile: mobile || user.mobile,
    };

    if (extra.payoutType === 'UPI') {
      if (!vpa) return res.status(400).json({ success: 'failed', msg: 'vpa is required for UPI payout' });
      extra.vpa = vpa;
    } else if (extra.payoutType === 'IFSC') {
      if (!ifsc || !account) return res.status(400).json({ success: 'failed', msg: 'ifsc and account are required for IFSC payout' });
      extra.ifsc = ifsc;
      extra.account = account;
    }

    const apiRes = await simplypay.createPayoutOrder({
      merOrderNo: payoutId,
      amount: parseFloat(payout.amount.toString()),
      attach: `withdraw_${payoutId}`,
      extra,
    });

    if (apiRes.code !== 0) {
      return res.status(400).json({ success: 'failed', msg: apiRes.msg || 'SimplyPay payout failed', data: apiRes.data });
    }

    return res.json({
      success: true,
      msg: 'Payout processed via SimplyPay',
      payoutId,
      orderNo: apiRes.data?.orderNo || null,
    });
  } catch (err) {
    console.error('simplypay processPayout error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to process payout' });
  }
};

// SimplyPay payout webhook callback (no auth - called by gateway)
exports.payoutCallback = async (req, res) => {
  try {
    const body = req.body;

    if (!simplypay.verifySign(body)) {
      console.error('SimplyPay payout callback signature mismatch');
      return res.status(200).json({ success: true });
    }

    const { merOrderNo, orderStatus } = body.data || {};
    if (!merOrderNo) return res.status(200).json({ success: true });

    const payout = await Payout.findOne({ payoutId: merOrderNo });
    if (!payout) return res.status(200).json({ success: true });

    if (payout.status !== 'pending') return res.status(200).json({ success: true });

    const SUCCESS_STATUSES = [2, 3];
    const FAILED_STATUSES = [-1, -2];

    if (SUCCESS_STATUSES.includes(orderStatus)) {
      payout.status = 'success';
      payout.completedAt = new Date();
      payout.remark = `SimplyPay order: ${body.data?.orderNo || ''}`;
      await payout.save();
    } else if (FAILED_STATUSES.includes(orderStatus)) {
      payout.status = 'failed';
      payout.failedAt = new Date();
      payout.remark = `SimplyPay status: ${orderStatus}`;
      await payout.save();

      if (payout.trnId) {
        const originalTxn = await Transaction.findOne({ trnId: payout.trnId });
        if (originalTxn) {
          originalTxn.status = 'reversed';
          originalTxn.remark = `SimplyPay payout failed: ${orderStatus}`;
          await originalTxn.save();
        }
      }

      const refundAmount = parseFloat(payout.amount.toString());
      const currentBalance = await getCurrentBalance(payout.user);
      const newBalance = currentBalance + refundAmount;

      const seq = await getNextSequence('transactionId');
      const refundTrnId = formatTrnId(seq);

      await Transaction.create({
        trnId: refundTrnId,
        user: payout.user,
        userid: payout.userid,
        amount: refundAmount,
        type: 'credit',
        note: 'payout',
        remark: `Refund for failed payout ${payoutId}`,
        balanceAfter: newBalance,
        status: 'success',
        referenceId: merOrderNo,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('SimplyPay payoutCallback error:', err);
    return res.status(200).json({ success: true });
  }
};

// Query order status
exports.queryOrder = async (req, res) => {
  try {
    const { merOrderNo } = req.query;
    if (!merOrderNo) return res.status(400).json({ success: 'failed', msg: 'merOrderNo is required' });

    const apiRes = await simplypay.queryOrder(merOrderNo);
    return res.json({ success: true, data: apiRes.data || apiRes });
  } catch (err) {
    console.error('simplypay queryOrder error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to query order' });
  }
};
