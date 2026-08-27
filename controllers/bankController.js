const Bank = require('../models/Bank');

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

    // Check duplicate accountNumber globally (unique index)
    const existingAccount = await Bank.findOne({ accountNumber: accountNumber.trim() }).lean();
    if (existingAccount) {
      return res.status(422).json({ success: 'failed', msg: 'Account number already exists' });
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
    const { status } = req.query;
    const filter = { user: req.user.userId };
    if (status && ['enable', 'disable'].includes(status)) {
      filter.status = status;
    }

    const banks = await Bank.find(filter).sort({ createdAt: -1 }).lean();
    const cleaned = banks.map((b) => ({
      bankName: b.bankName,
      holderName: b.holderName,
      accountNumber: b.accountNumber,
      ifsc: b.ifsc,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));

    res.json({ success: true, msg: 'Banks fetched', count: cleaned.length, banks: cleaned });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch banks' });
  }
};

exports.updateBankStatus = async (req, res) => {
  try {
    const { accountNumber, status } = req.body;

    if (!status || !['enable', 'disable'].includes(status)) {
      return res.status(400).json({ success: 'failed', msg: 'Status must be enable or disable' });
    }

    if (!accountNumber) {
      return res.status(400).json({ success: 'failed', msg: 'accountNumber is required' });
    }

    const bank = await Bank.findOne({ accountNumber: accountNumber.trim(), user: req.user.userId });

    if (!bank) {
      return res.status(404).json({ success: 'failed', msg: 'Bank not found' });
    }

    bank.status = status;
    await bank.save();

    res.json({ success: true, msg: 'Bank status updated successfully', bank });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to update bank status' });
  }
};
