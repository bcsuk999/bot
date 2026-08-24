const Payin = require('../models/Payin');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const User = require('../models/User');
const { getRateFor } = require('./adminExchangeController');

function formatTrnId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TXN${ds}${String(seq).padStart(4, '0')}`;
}

async function getNextSequence(name) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

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

// List payins with pagination + filters (userid, status, network)
exports.adminListPayins = async (req, res) => {
  try {
    const { userid, status, network, trnId, payinId, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (userid && !isNaN(Number(userid))) filter.userid = Number(userid);
    if (status && ['pending', 'success', 'failed', 'reversed'].includes(status)) filter.status = status;
    if (network && ['TRC20', 'BEP20'].includes(String(network).toUpperCase())) filter.network = String(network).toUpperCase();
    if (payinId) filter.payinId = payinId;
    // if trnId given, find transaction's referenceId first
    if (trnId) {
      const txn = await Transaction.findOne({ trnId }).lean();
      if (!txn) return res.json({ success: true, msg: 'Payins fetched', count: 0, page: 1, limit: 20, totalPages: 0, payins: [] });
      filter.payinId = txn.referenceId;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [payinsRaw, count] = await Promise.all([
      Payin.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Payin.countDocuments(filter),
    ]);
    // enrich with linked transaction trnId (latest per payinId)
    const payinIds = payinsRaw.map((p) => p.payinId).filter(Boolean)
    let trnMap = {}
    if (payinIds.length) {
      const txns = await Transaction.find({ referenceId: { $in: payinIds } }).sort({ createdAt: -1 }).lean()
      for (const t of txns) {
        if (!trnMap[t.referenceId]) trnMap[t.referenceId] = t.trnId
      }
    }
    const payins = payinsRaw.map((p) => ({
      ...p,
      amount: p.amount != null ? parseFloat(p.amount.toString()) : p.amount,
      detectedAmount: p.detectedAmount != null ? parseFloat(p.detectedAmount.toString()) : null,
      trnId: trnMap[p.payinId] || null,
    }));
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

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [txns, count] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Transaction.countDocuments(filter),
    ]);

    const transactions = txns.map((t) => ({
      trnId: t.trnId,
      userid: t.userid,
      user: t.user,
      amount: t.amount ? parseFloat(t.amount.toString()) : t.amount,
      type: t.type,
      note: t.note,
      remark: t.remark,
      balanceAfter: t.balanceAfter ? parseFloat(t.balanceAfter.toString()) : t.balanceAfter,
      status: t.status,
      exchangeRate: t.exchangeRate != null ? parseFloat(t.exchangeRate.toString()) : null,
      creditedAmount: t.creditedAmount != null ? parseFloat(t.creditedAmount.toString()) : null,
      referenceId: t.referenceId,
      network: t.network,
      currency: t.currency,
      txHash: t.txHash,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

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
        amount: payin.amount != null ? parseFloat(payin.amount.toString()) : payin.amount,
        detectedAmount: payin.detectedAmount != null ? parseFloat(payin.detectedAmount.toString()) : null,
      };
    }
    res.json({
      success: true,
      msg: 'Transaction fetched',
      transaction: {
        trnId: txn.trnId,
        amount: parseFloat(txn.amount.toString()),
        type: txn.type,
        note: txn.note,
        remark: txn.remark,
        balanceAfter: parseFloat(txn.balanceAfter.toString()),
        status: txn.status,
        exchangeRate: txn.exchangeRate != null ? parseFloat(txn.exchangeRate.toString()) : null,
        creditedAmount: txn.creditedAmount != null ? parseFloat(txn.creditedAmount.toString()) : null,
        userid: txn.userid,
        user: txn.user,
        referenceId: txn.referenceId,
        network: txn.network,
        currency: txn.currency,
        txHash: txn.txHash,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      },
      payin,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch transaction' });
  }
};

// Approve pending -> success (credit balance) by trnId
// balance increase = amount * exchangeRate (admin configured rate)
exports.adminApproveTransaction = async (req, res) => {
  try {
    const { trnId } = req.params;
    const { txHash, remark, exchangeRate: overrideRate } = req.body;
    const txn = await Transaction.findOne({ trnId });
    if (!txn) return res.status(404).json({ success: 'failed', msg: 'Transaction not found' });
    if (txn.status !== 'pending') return res.status(400).json({ success: 'failed', msg: `Cannot approve, status is ${txn.status}` });
    if (txn.type !== 'credit') return res.status(400).json({ success: 'failed', msg: 'Only credit transactions can be approved as payin' });

    // Ensure user exists
    const user = await User.findById(txn.user).lean();
    if (!user) return res.status(404).json({ success: 'failed', msg: 'User not found' });

    const currentBalance = await getCurrentBalance(txn.user);
    const amount = parseBalance(txn.amount);
    // exchange rate factor: use override if provided, else fetch configured rate for currency/network
    let rate = 1;
    if (overrideRate != null) {
      const pr = Number(overrideRate);
      if (!isFinite(pr) || pr <= 0) return res.status(400).json({ success: 'failed', msg: 'Invalid exchangeRate' });
      rate = pr;
    } else {
      rate = await getRateFor(txn.currency || 'USDT', txn.network || null);
    }
    const creditedAmount = amount * rate;
    const newBalance = currentBalance + creditedAmount;

    txn.status = 'success';
    txn.balanceAfter = newBalance;
    txn.exchangeRate = rate;
    txn.creditedAmount = creditedAmount;
    if (txHash) txn.txHash = String(txHash).trim();
    if (remark) txn.remark = String(remark).trim();
    await txn.save();

    // update linked payin if exists
    if (txn.referenceId) {
      const payin = await Payin.findOne({ payinId: txn.referenceId });
      if (payin) {
        payin.status = 'success';
        if (txHash) payin.txHash = String(txHash).trim();
        payin.completedAt = new Date();
        if (remark) payin.remark = String(remark).trim();
        payin.detectedAmount = amount;
        payin.exchangeRate = rate;
        payin.creditedAmount = creditedAmount;
        await payin.save();
      }
    }

    res.json({
      success: true,
      msg: 'Transaction approved',
      transaction: {
        trnId: txn.trnId,
        amount: parseFloat(txn.amount.toString()),
        type: txn.type,
        note: txn.note,
        remark: txn.remark,
        balanceAfter: parseFloat(txn.balanceAfter.toString()),
        status: txn.status,
        exchangeRate: txn.exchangeRate != null ? parseFloat(txn.exchangeRate.toString()) : null,
        creditedAmount: txn.creditedAmount != null ? parseFloat(txn.creditedAmount.toString()) : null,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to approve transaction' });
  }
};

// Reject pending -> failed
exports.adminRejectTransaction = async (req, res) => {
  try {
    const { trnId } = req.params;
    const { remark } = req.body;
    const txn = await Transaction.findOne({ trnId });
    if (!txn) return res.status(404).json({ success: 'failed', msg: 'Transaction not found' });
    if (txn.status !== 'pending') return res.status(400).json({ success: 'failed', msg: `Cannot reject, status is ${txn.status}` });

    txn.status = 'failed';
    if (remark) txn.remark = String(remark).trim();
    // balanceAfter stays as old (no credit)
    await txn.save();

    if (txn.referenceId) {
      const payin = await Payin.findOne({ payinId: txn.referenceId });
      if (payin) {
        payin.status = 'failed';
        payin.failedAt = new Date();
        if (remark) payin.remark = String(remark).trim();
        await payin.save();
      }
    }

    res.json({
      success: true,
      msg: 'Transaction rejected',
      transaction: {
        trnId: txn.trnId,
        amount: parseFloat(txn.amount.toString()),
        type: txn.type,
        note: txn.note,
        remark: txn.remark,
        balanceAfter: parseFloat(txn.balanceAfter.toString()),
        status: txn.status,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to reject transaction' });
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

    const seq = await getNextSequence('transactionId');
    const newTrnId = formatTrnId(seq);

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
      exchangeRate: original.exchangeRate != null ? parseBalance(original.exchangeRate) : null,
      creditedAmount: credited,
    });

    // Mark original as reversed
    original.status = 'reversed';
    await original.save();

    if (original.referenceId) {
      const payin = await Payin.findOne({ payinId: original.referenceId });
      if (payin) {
        payin.status = 'reversed';
        payin.reversedAt = new Date();
        await payin.save();
      }
    }

    res.json({
      success: true,
      msg: 'Transaction reversed',
      original: { trnId: original.trnId, status: original.status },
      reversal: {
        trnId: reversal.trnId,
        amount: parseFloat(reversal.amount.toString()),
        type: reversal.type,
        note: reversal.note,
        remark: reversal.remark,
        balanceAfter: parseFloat(reversal.balanceAfter.toString()),
        status: reversal.status,
        createdAt: reversal.createdAt,
        updatedAt: reversal.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to reverse transaction' });
  }
};
