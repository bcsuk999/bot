const Payin = require('../models/Payin');
const Transaction = require('../models/Transaction');
const { getRateFor } = require('./adminExchangeController');
const { approvePayin } = require('../services/payinService');
const { reverseCommission } = require('../services/commissionService');
const { parseBalance, getCurrentBalance, generateOrderId, toNum, getPagination, serializeTransaction } = require('../utils/helpers');
const logger = require('../utils/logger');

// List payins with pagination + filters (userid, status, network)
exports.adminListPayins = async (req, res) => {
  try {
    const { userid, status, network, payinId, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (userid && !isNaN(Number(userid))) filter.userid = Number(userid);
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (network && ['TRC20', 'BEP20', 'SPAY'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();
    if (payinId) filter.payinId = { $regex: String(payinId).trim(), $options: 'i' };

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [payinsRaw, count] = await Promise.all([
      Payin.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Payin.countDocuments(filter),
    ]);
    const payins = payinsRaw.map((p) => {
      const isInr = p.currency === 'INR' || p.network === 'SPAY';
      const row = {
        payinId: p.payinId,
        userid: p.userid,
        currency: p.currency,
        amount: toNum(p.amount),
        network: p.network,
        status: p.status,
        txHash: p.txHash,
        remark: p.remark,
        bonus: toNum(p.bonusAmount) || 0,
        receivedAmount: toNum(p.receivedAmount) || toNum(p.creditedAmount) || toNum(p.amount),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
      if (isInr) {
        row.deepLink = p.address;
      } else {
        row.address = p.address;
        row.exchangeRate = toNum(p.exchangeRate);
      }
      return row;
    });
    res.json({ success: true, msg: 'Payins fetched', count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), payins });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch payins' });
  }
};

// List transactions with pagination + filters (trnId, userid, status, type, note)
exports.adminListTransactions = async (req, res) => {
  try {
    const { userid, trnId, status, type, note, network, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (userid && !isNaN(Number(userid))) filter.userid = Number(userid);
    if (trnId) filter.trnId = trnId;
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (type && ['credit', 'debit'].includes(type)) filter.type = type;
    if (note && ['payin', 'payout', 'reversal'].includes(note)) filter.note = note;
    if (network && ['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [txns, count] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Transaction.countDocuments(filter),
    ]);

    const transactions = txns.map((t) => serializeTransaction(t));

    res.json({ success: true, msg: 'Transactions fetched', count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), transactions });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch transactions' });
  }
};

// Get single transaction by trnId (admin)
exports.adminGetTransactionByTrnId = async (req, res) => {
  try {
    const { trnId } = req.params;
    const txn = await Transaction.findOne({ trnId }).lean({ getters: true });
    if (!txn) return res.status(404).json({ success: 'failed', msg: 'Transaction not found' });
    let payin = txn.referenceId ? await Payin.findOne({ payinId: txn.referenceId }).lean({ getters: true }) : null;
    if (payin) {
      payin = {
        ...payin,
        amount: toNum(payin.amount),
      };
    }
    res.json({
      success: true,
      msg: 'Transaction fetched',
      transaction: serializeTransaction(txn),
      payin,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch transaction' });
  }
};

// Approve payin -> create success credit transaction (balance increase = amount * exchangeRate)
exports.adminApproveTransaction = async (req, res) => {
  try {
    const { payinId } = req.params;
    const { txHash, remark } = req.body;

    const payin = await Payin.findOne({ payinId });
    if (!payin) return res.status(404).json({ success: 'failed', msg: 'Payin not found' });
    if (payin.status !== 'pending') return res.status(400).json({ success: 'failed', msg: `Cannot approve, payin status is ${payin.status}` });

    const transaction = await approvePayin(payin, { txHash, remark });

    res.json({
      success: true,
      msg: `Payin ${payin.payinId} approved`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: 'failed', msg: err.message });
    logger.error({ err }, 'adminApproveTransaction error');
    res.status(500).json({ success: 'failed', msg: 'Failed to approve transaction' });
  }
};

// Reject payin -> update payin status to failed (no transaction, no balance change)
exports.adminRejectTransaction = async (req, res) => {
  try {
    const { payinId } = req.params;
    const { remark } = req.body;

    const payin = await Payin.findOne({ payinId });
    if (!payin) return res.status(404).json({ success: 'failed', msg: 'Payin not found' });
    if (payin.status !== 'pending') return res.status(400).json({ success: 'failed', msg: `Cannot reject, payin status is ${payin.status}` });

    payin.status = 'failed';
    if (remark) payin.remark = String(remark).trim();
    await payin.save();

    res.json({
      success: true,
      msg: 'Payin rejected',
      payin: {
        payinId: payin.payinId,
        amount: toNum(payin.amount),
        status: payin.status,
        remark: payin.remark,
      },
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to reject payin' });
  }
};

// Reverse success -> create reversal debit entry + mark original reversed
// deducts the same creditedAmount that was added (amount * exchangeRate)
exports.adminReverseTransaction = async (req, res) => {
  try {
    const { trnId } = req.params;
    const { remark } = req.body;
    const original = await Transaction.findOne({ trnId });
    if (!original) return res.status(404).json({ success: 'failed', msg: 'Transaction not found' });
    if (original.status !== 'success') return res.status(400).json({ success: 'failed', msg: `Only success transactions can be reversed, current is ${original.status}` });
    if (original.type !== 'credit') return res.status(400).json({ success: 'failed', msg: 'Only credit transactions can be reversed' });

    const currentBalance = await getCurrentBalance(original.user);
    const amount = parseBalance(original.amount);
    // use stored creditedAmount if available, else amount*rate
    let credited = original.creditedAmount != null ? parseBalance(original.creditedAmount) : null;
    if (credited == null || isNaN(credited)) {
      const rate = original.exchangeRate != null ? parseBalance(original.exchangeRate) : await getRateFor(original.currency || 'USDT', original.network || null);
      credited = amount * rate;
    }
    if (currentBalance < credited) return res.status(400).json({ success: 'failed', msg: 'Insufficient balance to reverse' });
    const newBalance = currentBalance - credited;

    const newTrnId = generateOrderId('TXN');

    const reversal = await Transaction.create({
      trnId: newTrnId,
      user: original.user,
      userid: original.userid,
      amount,
      type: 'debit',
      note: 'reversal',
      remark: remark ? String(remark).trim() : `Reversal of ${original.trnId}`,
      balanceAfter: newBalance,
      status: 'success',
      referenceId: original.trnId,
      network: original.network,
      currency: original.currency,
      exchangeRate: toNum(original.exchangeRate),
      creditedAmount: credited,
    });

    // Mark original as reversed
    original.status = 'reversed';
    await original.save();

    if (original.referenceId) {
      const payin = await Payin.findOne({ payinId: original.referenceId });
      if (payin) {
        payin.status = 'reversed';
        await payin.save();
      }
      await reverseCommission({ payinId: original.referenceId, remark });
    }

    res.json({
      success: true,
      msg: 'Transaction reversed',
      original: { trnId: original.trnId, status: original.status },
      reversal: serializeTransaction(reversal),
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to reverse transaction' });
  }
};
