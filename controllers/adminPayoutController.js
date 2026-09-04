const Payout = require('../models/Payout');
const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');
const User = require('../models/User');
const Bank = require('../models/Bank');

function parseBalance(v) {
  if (v == null) return 0;
  const n = parseFloat(v.toString());
  return isNaN(n) ? 0 : n;
}

async function getCurrentBalance(userObjectId) {
  const last = await Transaction.findOne({ user: userObjectId, status: 'success' })
    .sort({ createdAt: -1 })
    .lean();
  if (last && last.balanceAfter != null) return parseBalance(last.balanceAfter);
  return 0;
}

async function getNextSequence(name) {
  const c = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return c.seq;
}

function formatPayoutId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `PAYOUT${ds}${String(seq).padStart(4, '0')}`;
}

function formatTrnId(seq) {
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TXN${ds}${String(seq).padStart(4, '0')}`;
}

exports.listPayoutUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [users, count] = await Promise.all([
      User.find({ withdrawal: true, status: 'active', role: 'user' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments({ withdrawal: true, status: 'active', role: 'user' }),
    ]);

    const userIds = users.map((u) => u._id);

    const [banks, balanceResults] = await Promise.all([
      Bank.find({ user: { $in: userIds }, status: 'enable' })
        .select('user bankName holderName accountNumber ifsc status')
        .lean(),
      Transaction.aggregate([
        { $match: { user: { $in: userIds }, status: 'success' } },
        { $sort: { user: 1, createdAt: -1 } },
        { $group: { _id: '$user', balance: { $first: '$balanceAfter' } } },
      ]),
    ]);

    const bankMap = {};
    banks.forEach((b) => {
      const key = b.user.toString();
      if (!bankMap[key]) bankMap[key] = [];
      bankMap[key].push({
        bankName: b.bankName,
        holderName: b.holderName,
        accountNumber: b.accountNumber,
        ifsc: b.ifsc,
        status: b.status,
      });
    });

    const balanceMap = {};
    balanceResults.forEach((r) => {
      balanceMap[r._id.toString()] = r.balance != null ? parseBalance(r.balance) : 0;
    });

    const result = users.map((u) => ({
      uid: u.userid,
      mobile: u.mobile,
      balance: balanceMap[u._id.toString()] || 0,
      withdrawal: u.withdrawal,
      banks: bankMap[u._id.toString()] || [],
    }));

    return res.json({
      success: true,
      msg: 'Payout users fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      users: result,
    });
  } catch (err) {
    console.error('listPayoutUsers error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch payout users' });
  }
};

exports.createPayout = async (req, res) => {
  try {
    const { userid, amount, numberOfOrders, accountNumber } = req.body;

    if (!userid || !amount || !numberOfOrders || !accountNumber) {
      return res.status(400).json({ success: 'failed', msg: 'userid, amount, numberOfOrders, and accountNumber are required' });
    }

    const parsedAmount = Number(amount);
    const parsedOrders = Number(numberOfOrders);

    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid amount' });
    }

    if (!isFinite(parsedOrders) || parsedOrders <= 0 || !Number.isInteger(parsedOrders)) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid numberOfOrders' });
    }

    const user = await User.findOne({ userid: parseInt(userid), role: 'user' }).lean();
    if (!user || !user.withdrawal || user.status !== 'active') {
      return res.status(404).json({ success: 'failed', msg: 'User not found or payout not enabled' });
    }

    const bank = await Bank.findOne({
      user: user._id,
      accountNumber: accountNumber.trim(),
      status: 'enable',
    }).lean();

    if (!bank) {
      return res.status(400).json({ success: 'failed', msg: 'Bank account not found or not active' });
    }

    const currentBalance = await getCurrentBalance(user._id);
    const totalDeduction = parsedAmount * parsedOrders;

    if (currentBalance < totalDeduction) {
      return res.status(400).json({
        success: 'failed',
        msg: `Insufficient balance. Required: ${totalDeduction}, Available: ${currentBalance}`,
      });
    }

    const payouts = [];
    let runningBalance = currentBalance;

    for (let i = 0; i < parsedOrders; i++) {
      const payoutSeq = await getNextSequence('payoutId');
      const txnSeq = await getNextSequence('transactionId');
      const payoutId = formatPayoutId(payoutSeq);
      const trnId = formatTrnId(txnSeq);

      runningBalance -= parsedAmount;

      const payout = await Payout.create({
        payoutId,
        user: user._id,
        userid: user.userid,
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
        user: user._id,
        userid: user.userid,
        amount: parsedAmount,
        type: 'debit',
        note: 'payout',
        remark: '',
        balanceAfter: runningBalance,
        status: 'success',
        referenceId: payoutId,
      });

      payouts.push({
        payoutId: payout.payoutId,
        amount: parseFloat(payout.amount.toString()),
        status: payout.status,
        bankName: payout.bankName,
        holderName: payout.holderName,
        accountNumber: payout.accountNumber,
        ifsc: payout.ifsc,
        trnId: payout.trnId,
        createdAt: payout.createdAt,
      });
    }

    return res.status(201).json({
      success: true,
      msg: `${parsedOrders} payout orders created`,
      totalDeduction,
      payouts,
    });
  } catch (err) {
    console.error('createPayout error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to create payout orders' });
  }
};

exports.listPayouts = async (req, res) => {
  try {
    const { userid, status, payoutId, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (userid && !isNaN(Number(userid))) filter.userid = Number(userid);
    if (status && ['pending', 'success', 'failed'].includes(status)) filter.status = status;
    if (payoutId) filter.payoutId = payoutId;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [payoutsRaw, count] = await Promise.all([
      Payout.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean({ getters: true }),
      Payout.countDocuments(filter),
    ]);

    const payouts = payoutsRaw.map((p) => ({
      payoutId: p.payoutId,
      userid: p.userid,
      amount: p.amount != null ? parseFloat(p.amount.toString()) : p.amount,
      status: p.status,
      bankName: p.bankName,
      holderName: p.holderName,
      accountNumber: p.accountNumber,
      ifsc: p.ifsc,
      trnId: p.trnId,
      remark: p.remark,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return res.json({
      success: true,
      msg: 'Payouts fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      payouts,
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch payouts' });
  }
};

exports.approvePayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { remark } = req.body;

    if (!remark || !String(remark).trim()) {
      return res.status(400).json({ success: 'failed', msg: 'remark is required' });
    }

    const payout = await Payout.findOne({ payoutId });
    if (!payout) {
      return res.status(404).json({ success: 'failed', msg: 'Payout not found' });
    }

    if (payout.status !== 'pending') {
      return res.status(400).json({ success: 'failed', msg: `Cannot approve, status is ${payout.status}` });
    }

    payout.status = 'success';
    payout.remark = String(remark).trim();
    payout.completedAt = new Date();
    payout.approvedBy = req.user.userId;
    await payout.save();

    return res.json({
      success: true,
      msg: 'Payout approved',
      payout: {
        payoutId: payout.payoutId,
        amount: parseFloat(payout.amount.toString()),
        status: payout.status,
        remark: payout.remark,
        trnId: payout.trnId,
        completedAt: payout.completedAt,
      },
    });
  } catch (err) {
    console.error('approvePayout error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to approve payout' });
  }
};

exports.rejectPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { remark } = req.body;

    if (!remark || !String(remark).trim()) {
      return res.status(400).json({ success: 'failed', msg: 'remark is required' });
    }

    const payout = await Payout.findOne({ payoutId });
    if (!payout) {
      return res.status(404).json({ success: 'failed', msg: 'Payout not found' });
    }

    if (payout.status !== 'pending') {
      return res.status(400).json({ success: 'failed', msg: `Cannot reject, status is ${payout.status}` });
    }

    payout.status = 'failed';
    payout.remark = String(remark).trim();
    payout.failedAt = new Date();
    payout.approvedBy = req.user.userId;
    await payout.save();

    if (payout.trnId) {
      const originalTxn = await Transaction.findOne({ trnId: payout.trnId });
      if (originalTxn) {
        originalTxn.status = 'reversed';
        originalTxn.remark = String(remark).trim();
        await originalTxn.save();
      }
    }

    const refundAmount = parseFloat(payout.amount.toString());
    const currentBalance = await getCurrentBalance(payout.user);
    const newBalance = currentBalance + refundAmount;

    const txnSeq = await getNextSequence('transactionId');
    const refundTrnId = formatTrnId(txnSeq);

    await Transaction.create({
      trnId: refundTrnId,
      user: payout.user,
      userid: payout.userid,
      amount: refundAmount,
      type: 'credit',
      note: 'payout',
      remark: `Refund for rejected payout ${payoutId}`,
      balanceAfter: newBalance,
      status: 'success',
      referenceId: payoutId,
    });

    return res.json({
      success: true,
      msg: 'Payout rejected',
      payout: {
        payoutId: payout.payoutId,
        amount: parseFloat(payout.amount.toString()),
        status: payout.status,
        remark: payout.remark,
        failedAt: payout.failedAt,
      },
    });
  } catch (err) {
    console.error('rejectPayout error:', err);
    return res.status(500).json({ success: 'failed', msg: 'Failed to reject payout' });
  }
};
