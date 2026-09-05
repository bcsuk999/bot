const Payin = require('../models/Payin');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const DepositAddress = require('../models/DepositAddress');
const { resolveRate } = require('./payinExchangeController');

async function getDepositAddress(network) {
  try {
    const doc = await DepositAddress.findOne({ network, isActive: true, currency: 'USDT' }).lean();
    if (doc && doc.address) return doc.address;
  } catch (_) {}
  return null;
}

const REQUIRED_CONFIRMATIONS = {
  TRC20: 20,
  BEP20: 15,
};

async function getNextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

function formatPayinId(seq) {
  const date = new Date();
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `PAY${d}${String(seq).padStart(4, '0')}`;
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

    const payinSeq = await getNextSequence('payinId');
    const payinId = formatPayinId(payinSeq);

    const requiredConfirmations = REQUIRED_CONFIRMATIONS[network] || 12;

    const payin = await Payin.create({
      payinId,
      user: req.user.userId,
      userid: req.user.userid,
      currency,
      amount: parsedAmount,
      network,
      address,
      status: 'pending',
      transactionType: 'payin',
      requiredConfirmations,
      remark: `${currency} ${network} deposit`,
      exchangeRate,
      creditedAmount: receivedAmount,
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
    console.error('createPayin error:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: 'failed', msg: 'Duplicate payin, please retry' });
    }
    return res.status(500).json({ success: 'failed', msg: 'Failed to create payin' });
  }
};

function toNum(v) {
  if (v == null) return v;
  return typeof v === 'object' && v.toString ? parseFloat(v.toString()) : Number(v);
}
exports.getPayinList = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, network } = req.query;
    const filter = { user: req.user.userId };
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (network && ['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [payinsRaw, count] = await Promise.all([
      Payin.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Payin.countDocuments(filter),
    ]);
    const payins = payinsRaw.map((p) => ({
      payinId: p.payinId,
      currency: p.currency,
      amount: toNum(p.amount),
      receivedAmount: p.creditedAmount != null ? toNum(p.creditedAmount) : null,
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
    const filter = { user: req.user.userId };
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (type && ['credit', 'debit'].includes(type)) filter.type = type;
    if (note && ['payin', 'payout', 'reversal'].includes(note)) filter.note = note;
    if (network && ['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [txnsRaw, count] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Transaction.countDocuments(filter),
    ]);
    const transactions = txnsRaw.map((t) => ({
      trnId: t.trnId,
      currency: t.currency,
      amount: t.amount ? parseFloat(t.amount.toString()) : t.amount,
      type: t.type,
      note: t.note,
      remark: t.remark,
      balanceAfter: t.balanceAfter ? parseFloat(t.balanceAfter.toString()) : t.balanceAfter,
      status: t.status,
      exchangeRate: t.exchangeRate != null ? parseFloat(t.exchangeRate.toString()) : null,
      creditedAmount: t.creditedAmount != null ? parseFloat(t.creditedAmount.toString()) : null,
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
    const last = await Transaction.findOne({ user: req.user.userId, status: 'success' })
      .sort({ createdAt: -1 })
      .lean({ getters: true });
    let balance = 0;
    if (last && last.balanceAfter != null) {
      balance = parseFloat(last.balanceAfter.toString());
      if (isNaN(balance)) balance = 0;
    }
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

    const payin = await Payin.findOne({ payinId, user: req.user.userId });
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
