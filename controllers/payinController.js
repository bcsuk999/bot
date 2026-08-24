const Payin = require('../models/Payin');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const DepositAddress = require('../models/DepositAddress');

const FALLBACK_DEPOSIT_ADDRESSES = {
  TRC20: 'TQRcQg2naLxZGxuWCv7E53VgEasRAdPL8v',
  BEP20: '0x4993D6bD7E9b27D5B306F36ec0b4Cea8927BB2fB',
};

async function getDepositAddress(network) {
  try {
    const doc = await DepositAddress.findOne({ network, isActive: true, currency: 'USDT' }).lean();
    if (doc && doc.address) return doc.address;
  } catch (_) {}
  return FALLBACK_DEPOSIT_ADDRESSES[network] || null;
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

function formatTrnId(seq) {
  const date = new Date();
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `TXN${d}${String(seq).padStart(4, '0')}`;
}

exports.createPayin = async (req, res) => {
  try {
    // accept both amt/amount and net/network
    let { amount, amt, network, net, currency } = req.body;
    amount = amount != null ? amount : amt;
    network = network != null ? network : net;
    currency = currency ? String(currency).toUpperCase() : 'USDT';

    if (amount == null || network == null) {
      return res.status(400).json({ success: 'failed', msg: 'amount and network are required' });
    }

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

    const payinSeq = await getNextSequence('payinId');
    const txnSeq = await getNextSequence('transactionId');
    const payinId = formatPayinId(payinSeq);
    const trnId = formatTrnId(txnSeq);

    const requiredConfirmations = REQUIRED_CONFIRMATIONS[network] || 12;

    // get current balanceAfter = last success transaction balanceAfter else 0
    const lastTxn = await Transaction.findOne({ user: req.user.userId, status: 'success' })
      .sort({ createdAt: -1 })
      .lean();
    let currentBalance = 0;
    if (lastTxn && lastTxn.balanceAfter != null) {
      // balanceAfter may be Decimal128
      const raw = lastTxn.balanceAfter;
      currentBalance = raw ? parseFloat(raw.toString()) : 0;
      if (isNaN(currentBalance)) currentBalance = 0;
    } else {
      // fallback: sum of all success if no last with balanceAfter (legacy)
      // but for phase 1, 0 is fine
      currentBalance = 0;
      // Try aggregate as backup if lastTxn missing but history exists
      const agg = await Transaction.aggregate([
        { $match: { user: req.user.userId, status: 'success' } },
        { $group: { _id: null, total: { $sum: '$balanceAfter' } } },
      ]);
      // not accurate, but we stick to lastTxn method; keep 0 if no success
    }

    const balanceAfterPending = currentBalance; // pending does NOT increase

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
    });

    const transaction = await Transaction.create({
      trnId,
      user: req.user.userId,
      userid: req.user.userid,
      amount: parsedAmount,
      type: 'credit',
      note: 'payin',
      remark: `${network} deposit`,
      balanceAfter: balanceAfterPending,
      status: 'pending',
      referenceId: payin.payinId,
      network,
      currency,
    });

    return res.status(201).json({
      success: true,
      msg: 'Payin created',
      payin: {
        id: payin.payinId,
        currency: payin.currency,
        amount: parseFloat(payin.amount.toString()),
        network: payin.network,
        address: payin.address,
        status: payin.status,
        transactionType: payin.transactionType,
        remark: payin.remark,
      },
      transaction: {
        trnId: transaction.trnId,
        amount: parseFloat(transaction.amount.toString()),
        type: transaction.type,
        note: transaction.note,
        remark: transaction.remark,
        balanceAfter: parseFloat(transaction.balanceAfter.toString()),
        status: transaction.status,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
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
    const payinsRaw = await Payin.find({ user: req.user.userId }).sort({ createdAt: -1 }).lean({ getters: true });
    const payins = payinsRaw.map((p) => ({
      ...p,
      amount: toNum(p.amount),
      detectedAmount: p.detectedAmount != null ? toNum(p.detectedAmount) : null,
    }));
    return res.json({ success: true, msg: 'Payins fetched', count: payins.length, payins });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch payins' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const filter = { user: req.user.userId };
    const txns = await Transaction.find(filter).sort({ createdAt: -1 }).lean({ getters: true });
    // map to required shape
    const transactions = txns.map((t) => ({
      trnId: t.trnId,
      amount: t.amount ? parseFloat(t.amount.toString()) : t.amount,
      type: t.type,
      note: t.note,
      remark: t.remark,
      balanceAfter: t.balanceAfter ? parseFloat(t.balanceAfter.toString()) : t.balanceAfter,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    return res.json({ success: true, msg: 'Transactions fetched', count: transactions.length, transactions });
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
    return res.json({ success: true, msg: 'Balance fetched', balance, currency: 'USDT' });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch balance' });
  }
};
