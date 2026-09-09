const Payin = require('../models/Payin');
const Transaction = require('../models/Transaction');
const DepositAddress = require('../models/DepositAddress');
const { resolveRate } = require('./payinExchangeController');
const { generateOrderId, toNum, getPagination, getCurrentBalance } = require('../utils/helpers');
const logger = require('../utils/logger');

async function getDepositAddress(network) {
  try {
    const doc = await DepositAddress.findOne({ network, isActive: true, currency: 'USDT' }).lean();
    if (doc && doc.address) return doc.address;
  } catch (_) {}
  return null;
}

exports.createPayin = async (req, res) => {
  try {
    // accept both amt/amount and net/network
    let { amount, amt, network, net, currency } = req.body;
    amount = amount != null ? amount : amt;
    network = network != null ? network : net;
    if (amount == null || network == null || currency == null) {
      return res.status(400).json({ success: 'failed', msg: 'amount, network, and currency are required' });
    }

    currency = String(currency).toUpperCase();

    if (currency !== 'USDT') {
      return res.status(400).json({ success: 'failed', msg: 'currency must be USDT' });
    }

    const parsedAmount = Number(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid amount' });
    }

    network = String(network).toUpperCase().trim();
    if (!['TRC20', 'BEP20'].includes(network)) {
      return res.status(400).json({ success: 'failed', msg: 'network must be TRC20 or BEP20' });
    }

    const address = await getDepositAddress(network);
    if (!address) {
      return res.status(400).json({ success: 'failed', msg: `Deposit address not configured for ${network}` });
    }

    const exchangeRate = await resolveRate();
    const receivedAmount = parsedAmount * exchangeRate;

    const payinId = generateOrderId('P');

    const payin = await Payin.create({
      payinId,
      userid: req.user.userid,
      currency,
      amount: parsedAmount,
      network,
      address,
      status: 'pending',
      transactionType: 'payin',
      remark: `${currency} ${network} deposit`,
      exchangeRate,
      creditedAmount: receivedAmount,
      receivedAmount,
    });

    return res.status(201).json({
      success: true,
      payinId: payin.payinId,
      address: payin.address,
      currency: payin.currency,
      amount: parseFloat(payin.amount.toString()),
      network: payin.network,
      exchangeRate,
      receivedAmount,
    });
  } catch (err) {
    logger.error({ err }, 'createPayin error');
    if (err.code === 11000) {
      return res.status(409).json({ success: 'failed', msg: 'Duplicate payin, please retry' });
    }
    return res.status(500).json({ success: 'failed', msg: 'Failed to create payin' });
  }
};

exports.getPayinList = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, network } = req.query;
    const filter = { userid: req.user.userid };
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (network && ['TRC20', 'BEP20', 'SPAY'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [payinsRaw, count] = await Promise.all([
      Payin.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Payin.countDocuments(filter),
    ]);
    const payins = payinsRaw.map((p) => ({
      payinId: p.payinId,
      currency: p.currency,
      amount: toNum(p.amount),
      bonusAmount: toNum(p.bonusAmount) || 0,
      receivedAmount: toNum(p.receivedAmount) || toNum(p.creditedAmount) || toNum(p.amount),
      status: p.status,
      transactionType: p.transactionType,
      remark: p.remark,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    return res.json({ success: true, count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), payins });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch payins' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type, note, network } = req.query;
    const filter = { userid: req.user.userid };
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (type && ['credit', 'debit'].includes(type)) filter.type = type;
    if (note && ['payin', 'payout', 'reversal'].includes(note)) filter.note = note;
    if (network && ['TRC20', 'BEP20', 'INR'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [txnsRaw, count] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Transaction.countDocuments(filter),
    ]);
    const transactions = txnsRaw.map((t) => ({
      trnId: t.trnId,
      currency: t.currency,
      amount: toNum(t.amount),
      type: t.type,
      note: t.note,
      remark: t.remark,
      balanceAfter: toNum(t.balanceAfter),
      status: t.status,
      exchangeRate: toNum(t.exchangeRate),
      creditedAmount: toNum(t.creditedAmount),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    return res.json({ success: true, msg: 'Transactions fetched', count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), transactions });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch transactions' });
  }
};

exports.getBalance = async (req, res) => {
  try {
    const balance = await getCurrentBalance(req.user.userId);
    return res.json({ success: true, balance });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch balance' });
  }
};

exports.submitPayinTxHash = async (req, res) => {
  try {
    const { payinId, txHash } = req.body;

    if (!payinId || !txHash) {
      return res.status(400).json({ success: 'failed', msg: 'payinId and txHash are required' });
    }

    const cleanHash = String(txHash).trim();

    const payin = await Payin.findOne({ payinId, userid: req.user.userid });
    if (!payin) {
      return res.status(404).json({ success: 'failed', msg: 'Payin not found' });
    }

    if (payin.status !== 'pending') {
      return res.status(400).json({ success: 'failed', msg: `Cannot submit txHash for payin with status ${payin.status}` });
    }

    if (payin.txHash) {
      return res.status(409).json({ success: 'failed', msg: 'Transaction hash already submitted', txHash: payin.txHash });
    }

    payin.txHash = cleanHash;
    payin.txSubmittedAt = new Date();
    await payin.save();

    return res.status(200).json({
      success: true,
      msg: 'Transaction hash submitted',
      payin: {
        payinId: payin.payinId,
        txHash: payin.txHash,
        network: payin.network,
        status: payin.status,
        txSubmittedAt: payin.txSubmittedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to submit transaction hash' });
  }
};
