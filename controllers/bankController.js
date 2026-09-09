const Bank = require('../models/Bank');
const { getPagination } = require('../utils/helpers');

exports.addBank = async (req, res) => {
  try {
    const { bankName, holderName, accountNumber, ifsc } = req.body;

    if (!bankName || !holderName || !accountNumber || !ifsc) {
      return res.status(400).json({ success: 'failed', msg: 'bankName, holderName, accountNumber and ifsc are required' });
    }

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifsc.toUpperCase())) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid IFSC format' });
    }

    const bank = new Bank({
      user: req.user.userId,
      userid: req.user.userid,
      bankName: bankName.trim(),
      holderName: holderName.trim(),
      accountNumber: accountNumber.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      status: 'enable'
    });

    await bank.save();

    res.status(201).json({
      success: true,
      msg: 'Bank added successfully',
      bank: {
        userid: bank.userid,
        bankName: bank.bankName,
        holderName: bank.holderName,
        accountNumber: bank.accountNumber,
        ifsc: bank.ifsc,
        status: bank.status,
        createdAt: bank.createdAt,
        updatedAt: bank.updatedAt,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(422).json({ success: 'failed', msg: `${field} already exists` });
    }
    res.status(500).json({ success: 'failed', msg: 'Failed to add bank' });
  }
};

exports.getBanks = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { user: req.user.userId };
    if (status && ['enable', 'disable'].includes(status)) {
      filter.status = status;
    }

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [banks, count] = await Promise.all([
      Bank.find(filter, 'bankName holderName accountNumber ifsc status createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Bank.countDocuments(filter),
    ]);

    res.json({ success: true, msg: 'Banks fetched', count, page: pageNum, limit: limitNum, totalPages: Math.ceil(count / limitNum), banks });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch banks' });
  }
};

exports.updateBankStatus = async (req, res) => {
  try {
    const { accountNumber, bankId, status } = req.body;

    if (!status || !['enable', 'disable'].includes(status)) {
      return res.status(400).json({ success: 'failed', msg: 'Status must be enable or disable' });
    }

    // Optimised: prefer _id (primary index) if provided, fallback to accountNumber for backward compat
    const trimmedAccount = accountNumber ? String(accountNumber).trim() : null;
    if (!bankId && !trimmedAccount) {
      return res.status(400).json({ success: 'failed', msg: 'accountNumber or bankId is required' });
    }

    const filter = bankId
      ? { _id: bankId, user: req.user.userId }
      : { accountNumber: trimmedAccount, user: req.user.userId };

    const bank = await Bank.findOneAndUpdate(
      filter,
      { $set: { status } },
      { returnDocument: 'after', projection: 'bankName holderName accountNumber ifsc status createdAt updatedAt' }
    ).lean();

    if (!bank) {
      return res.status(404).json({ success: 'failed', msg: 'Bank not found' });
    }

    res.json({ success: true, msg: 'Bank status updated successfully', bank });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: 'failed', msg: 'Invalid bankId' });
    }
    res.status(500).json({ success: 'failed', msg: 'Failed to update bank status' });
  }
};
