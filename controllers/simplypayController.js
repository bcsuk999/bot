const Payin = require('../models/Payin');
const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const simplypay = require('../services/simplypay');
const { calculateBonus } = require('./adminBonusController');
const { getCurrentBalance, generateOrderId, verifyPayoutPassword } = require('../utils/helpers');
const { approvePayin } = require('../services/payinService');
const { settleBotOrder } = require('./botWebhookController');
const logger = require('../utils/logger');

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

    const payinId = generateOrderId('P');

    const bonus = await calculateBonus(parsedAmount);
    const receivedAmount = parsedAmount + bonus;

    const payin = await Payin.create({
      payinId,
      userid: req.user.userid,
      currency: 'INR',
      amount: parsedAmount,
      network: 'SPAY',
      address: null,
      status: 'pending',
      transactionType: 'payin',
      remark: 'INR deposit via SimplyPay',
      exchangeRate: 1,
      creditedAmount: parsedAmount,
      bonusAmount: bonus,
      receivedAmount,
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
      const errMsg = apiRes.msg || apiRes.error || `SimplyPay error (code: ${apiRes.code})`;
      payin.status = 'failed';
      payin.remark = errMsg;
      await payin.save();
      return res.status(400).json({ success: 'failed', msg: errMsg });
    }

    const deepLink = apiRes.data?.params?.deepLink || null;
    if (deepLink) {
      payin.address = deepLink;
      await payin.save();
    }

    return res.status(201).json({
      success: true,
      payinId,
      amount: parsedAmount,
      bonus,
      receivedAmount,
      currency: 'INR',
      paymentLink: apiRes.data?.params?.paymentLink || null,
      deepLink,
      orderNo: apiRes.data?.orderNo || null,
    });
  } catch (err) {
    logger.error({ err }, 'simplypay createPayin error');
    return res.status(500).json({ success: 'failed', msg: err.message || 'Failed to create payin' });
  }
};

// SimplyPay payin webhook callback (no auth - called by gateway)
exports.payinCallback = async (req, res) => {
  try {
    const body = req.body;

    if (!simplypay.verifySign(body)) {
      logger.warn('SimplyPay callback signature mismatch');
      return res.status(200).json({ success: true });
    }

    const { merOrderNo, orderStatus } = body.data || {};
    if (!merOrderNo) return res.status(200).json({ success: true });

    const payin = await Payin.findOne({ payinId: merOrderNo });
    if (!payin) {
      // Not a user Payin. The gateway does not reliably honour the per-order
      // notifyUrl, so a group-deposit callback can land here instead of
      // /webhook/simplypay/bot. Settle it as a bot order rather than returning
      // 200 and silently dropping the payment.
      const botResult = await settleBotOrder(merOrderNo, orderStatus);
      if (botResult.action !== 'order_not_found') {
        logger.info({ merOrderNo, action: botResult.action }, 'payinCallback: settled as bot order');
      }
      return res.status(200).json({ success: true });
    }

    if (payin.status !== 'pending') return res.status(200).json({ success: true });

    const SUCCESS_STATUSES = [2, 3];
    const FAILED_STATUSES = [-1, -2];

    if (SUCCESS_STATUSES.includes(orderStatus)) {
      await approvePayin(payin);
    } else if (FAILED_STATUSES.includes(orderStatus)) {
      payin.status = 'failed';
      payin.remark = `SimplyPay status: ${orderStatus}`;
      await payin.save();
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'SimplyPay payinCallback error');
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
    logger.error({ err }, 'simplypay processPayout error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to process payout' });
  }
};

// SimplyPay payout webhook callback (no auth - called by gateway)
exports.payoutCallback = async (req, res) => {
  // TEMP DEBUG: log the complete gateway request so a failing payout callback can
  // be diagnosed from the raw payload. Remove this once the callback is fixed.
  console.log('[SimplyPay payout webhook] content-type:', req.headers['content-type']);
  console.log('[SimplyPay payout webhook] headers:', JSON.stringify(req.headers));
  console.log('[SimplyPay payout webhook] body:', JSON.stringify(req.body));

  try {
    const body = req.body;

    if (!simplypay.verifySign(body)) {
      console.log('[SimplyPay payout webhook] signature verification FAILED');
      logger.warn('SimplyPay payout callback signature mismatch');
      return res.status(200).json({ success: true });
    }

    console.log('[SimplyPay payout webhook] signature verification OK');

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

      // Merchant-level admin payouts have no user wallet to refund.
      if (payout.user) {
        const refundAmount = parseFloat(payout.amount.toString());
        const currentBalance = await getCurrentBalance(payout.user);
        const newBalance = currentBalance + refundAmount;

        const refundTrnId = generateOrderId('TXN');

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
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'SimplyPay payoutCallback error');
    return res.status(200).json({ success: true });
  }
};

// Admin creates a payout via SimplyPay.
//
// `userid` is optional: when present the payout debits that user's wallet, and
// when absent it is a merchant-level payout with no wallet or ledger entry.
// Bank details can be supplied directly (`ifsc`, `account`, `holderName`) or
// taken from one of the user's enabled bank accounts (`bankId` / first active
// bank). A second-step payout password is required for every withdrawal.
exports.adminCreatePayout = async (req, res) => {
  try {
    const {
      userid,
      amount,
      bankId,
      bankName,
      payoutType,
      vpa,
      ifsc,
      account,
      accountNumber,
      holderName,
      name,
      email,
      mobile,
      password,
    } = req.body;

    if (!amount) {
      return res.status(400).json({ success: 'failed', msg: 'amount is required' });
    }

    if (!verifyPayoutPassword(password)) {
      return res.status(403).json({ success: 'failed', msg: 'Invalid payout password' });
    }

    const parsedAmount = Number(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid amount' });
    }

    // userid is optional. When it is supplied the payout is tied to that user's
    // wallet and their balance is debited. Without it this is a merchant-level
    // admin payout: no user lookup, balance check or ledger entry.
    let user = null;
    if (userid != null && String(userid).trim() !== '') {
      user = await User.findOne({ userid: parseInt(userid), role: 'user' }).lean();
      if (!user) {
        return res.status(404).json({ success: 'failed', msg: 'User not found' });
      }

      if (!user.withdrawal) {
        return res.status(400).json({ success: 'failed', msg: 'Payout is disabled for this user' });
      }
    }

    // Direct bank details win over a stored bank account. All three are required
    // together so a payout can never go to a half-specified account.
    const directAccount = account ?? accountNumber;
    const hasDirectBank = ifsc != null || directAccount != null || holderName != null;

    let bankDetails;
    if (hasDirectBank) {
      if (!ifsc || !directAccount || !holderName) {
        return res.status(400).json({
          success: 'failed',
          msg: 'ifsc, account and holderName are required for a bank payout',
        });
      }

      bankDetails = {
        bankName: String(bankName || 'Bank Transfer').trim(),
        holderName: String(holderName).trim(),
        accountNumber: String(directAccount).trim(),
        ifsc: String(ifsc).trim().toUpperCase(),
      };
    } else {
      if (!user) {
        return res.status(400).json({
          success: 'failed',
          msg: 'ifsc, account and holderName are required when userid is not provided',
        });
      }

      const Bank = require('../models/Bank');
      let bank;
      if (bankId) {
        bank = await Bank.findOne({ _id: bankId, user: user._id, status: 'enable' }).lean();
        if (!bank) {
          return res.status(400).json({ success: 'failed', msg: 'Bank account not found or not active' });
        }
      } else {
        bank = await Bank.findOne({ user: user._id, status: 'enable' }).lean();
        if (!bank) {
          return res.status(400).json({ success: 'failed', msg: 'No active bank account found for user' });
        }
      }

      if (!bank.accountNumber || !bank.ifsc) {
        return res.status(400).json({ success: 'failed', msg: 'Bank account missing account number or IFSC' });
      }

      bankDetails = {
        bankName: bank.bankName,
        holderName: bank.holderName,
        accountNumber: bank.accountNumber,
        ifsc: bank.ifsc,
      };
    }

    // Validate the gateway destination before debiting the user, so a bad
    // request never leaves a payout debit behind.
    const resolvedPayoutType = hasDirectBank ? 'IFSC' : payoutType || 'IFSC';
    const extra = {
      payoutType: resolvedPayoutType,
      name: (holderName && String(holderName).trim()) || name || user?.mobile || bankDetails.holderName,
      email: email || (user?.mobile ? `${user.mobile}@example.com` : 'admin@subnpay'),
      mobile: mobile || user?.mobile || '',
    };

    if (extra.payoutType === 'UPI') {
      if (!vpa) {
        return res.status(400).json({ success: 'failed', msg: 'vpa is required for UPI payout' });
      }
      extra.vpa = String(vpa).trim();
    } else {
      extra.ifsc = bankDetails.ifsc;
      extra.account = bankDetails.accountNumber;
    }

    let currentBalance = null;
    if (user) {
      currentBalance = await getCurrentBalance(user._id);
      if (currentBalance < parsedAmount) {
        return res.status(400).json({
          success: 'failed',
          msg: `Insufficient balance. Required: ${parsedAmount}, Available: ${currentBalance}`,
        });
      }
    }

    const payoutId = generateOrderId('PO');
    const trnId = user ? generateOrderId('TXN') : null;
    const runningBalance = user ? currentBalance - parsedAmount : null;

    await Payout.create({
      payoutId,
      user: user?._id || null,
      userid: user?.userid ?? null,
      amount: parsedAmount,
      status: 'pending',
      bankName: bankDetails.bankName,
      holderName: bankDetails.holderName,
      accountNumber: bankDetails.accountNumber,
      ifsc: bankDetails.ifsc,
      trnId,
    });

    if (user) {
      await Transaction.create({
        trnId,
        user: user._id,
        userid: user.userid,
        amount: parsedAmount,
        type: 'debit',
        note: 'payout',
        remark: 'Admin initiated payout via SimplyPay',
        balanceAfter: runningBalance,
        status: 'success',
        referenceId: payoutId,
      });
    }

    const apiRes = await simplypay.createPayoutOrder({
      merOrderNo: payoutId,
      amount: parsedAmount,
      attach: `withdraw_${payoutId}`,
      extra,
    });

    if (apiRes.code !== 0) {
      const errMsg = apiRes.msg || apiRes.error || `SimplyPay error (code: ${apiRes.code})`;
      await Payout.findOneAndUpdate({ payoutId }, { status: 'failed', remark: errMsg });
      if (trnId) {
        await Transaction.findOneAndUpdate({ trnId }, { status: 'reversed', remark: errMsg });
      }
      return res.status(400).json({ success: 'failed', msg: errMsg });
    }

    return res.status(201).json({
      success: true,
      payoutId,
      userid: user?.userid ?? null,
      amount: parsedAmount,
      currency: 'INR',
      orderNo: apiRes.data?.orderNo || null,
      status: 'pending',
      bank: {
        bankName: bankDetails.bankName,
        holderName: bankDetails.holderName,
        accountNumber: bankDetails.accountNumber,
        ifsc: bankDetails.ifsc,
      },
    });
  } catch (err) {
    logger.error({ err }, 'simplypay adminCreatePayout error');
    return res.status(500).json({ success: 'failed', msg: err.message || 'Failed to create payout' });
  }
};

// User creates payout via SimplyPay
exports.createPayout = async (req, res) => {
  try {
    const { amount, bankId } = req.body;

    if (!amount) {
      return res.status(400).json({ success: 'failed', msg: 'amount is required' });
    }

    const parsedAmount = Number(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid amount' });
    }

    if (!req.user.withdrawal) {
      return res.status(400).json({ success: 'failed', msg: 'Payout is disabled. Enable it in settings first.' });
    }

    const Bank = require('../models/Bank');
    let bank;
    if (bankId) {
      bank = await Bank.findOne({ _id: bankId, user: req.user.userId, status: 'enable' }).lean();
      if (!bank) {
        return res.status(400).json({ success: 'failed', msg: 'Bank account not found or not active' });
      }
    } else {
      bank = await Bank.findOne({ user: req.user.userId, status: 'enable' }).lean();
      if (!bank) {
        return res.status(400).json({ success: 'failed', msg: 'No active bank account found. Add a bank account first.' });
      }
    }

    const currentBalance = await getCurrentBalance(req.user.userId);
    if (currentBalance < parsedAmount) {
      return res.status(400).json({
        success: 'failed',
        msg: `Insufficient balance. Required: ${parsedAmount}, Available: ${currentBalance}`,
      });
    }

    const payoutId = generateOrderId('PO');
    const trnId = generateOrderId('TXN');

    const runningBalance = currentBalance - parsedAmount;

    const Payout = require('../models/Payout');
    const Transaction = require('../models/Transaction');

    await Payout.create({
      payoutId,
      user: req.user.userId,
      userid: req.user.userid,
      amount: parsedAmount,
      status: 'pending',
      bankName: bank.bankName,
      holderName: bank.holderName,
      accountNumber: bank.accountNumber,
      ifsc: bank.ifsc,
      trnId,
    });

    await Transaction.create({
      trnId,
      user: req.user.userId,
      userid: req.user.userid,
      amount: parsedAmount,
      type: 'debit',
      note: 'payout',
      remark: '',
      balanceAfter: runningBalance,
      status: 'success',
      referenceId: payoutId,
    });

    const User = require('../models/User');
    const user = await User.findById(req.user.userId).lean();

    const extra = {
      payoutType: 'IFSC',
      name: user?.mobile || bank.holderName,
      email: `${user?.mobile || '9999999999'}@example.com`,
      mobile: user?.mobile || '',
      ifsc: bank.ifsc,
      account: bank.accountNumber,
    };

    const apiRes = await simplypay.createPayoutOrder({
      merOrderNo: payoutId,
      amount: parsedAmount,
      attach: `withdraw_${payoutId}`,
      extra,
    });

    if (apiRes.code !== 0) {
      const errMsg = apiRes.msg || apiRes.error || `SimplyPay error (code: ${apiRes.code})`;
      await Payout.findOneAndUpdate({ payoutId }, { status: 'failed', remark: errMsg });
      await Transaction.findOneAndUpdate({ trnId }, { status: 'reversed', remark: errMsg });
      return res.status(400).json({ success: 'failed', msg: errMsg });
    }

    return res.status(201).json({
      success: true,
      payoutId,
      amount: parsedAmount,
      currency: 'INR',
      orderNo: apiRes.data?.orderNo || null,
      status: 'pending',
    });
  } catch (err) {
    logger.error({ err }, 'simplypay createPayout error');
    return res.status(500).json({ success: 'failed', msg: err.message || 'Failed to create payout' });
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
    logger.error({ err }, 'simplypay queryOrder error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to query order' });
  }
};
