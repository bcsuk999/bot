const Bank = require('../models/Bank');
const { getPagination } = require('../utils/helpers');

exports.listBanks = async (req, res) => {
  try {
    const { userid, status, bankName, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (userid && !isNaN(Number(userid))) {
      filter.userid = Number(userid);
    }
    if (status && ['enable', 'disable'].includes(status)) {
      filter.status = status;
    }
    if (bankName) {
      filter.bankName = { $regex: bankName.trim(), $options: 'i' };
    }

    const { pageNum, limitNum, skip } = getPagination(page, limit);

    const [banks, count] = await Promise.all([
      Bank.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Bank.countDocuments(filter),
    ]);

    res.json({
      success: true,
      msg: 'All banks fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      banks,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch banks', error: err.message });
  }
};

exports.updateBankStatus = async (req, res) => {
  try {
    const { bankId } = req.params;
    const { status } = req.body;

    if (!status || !['enable', 'disable'].includes(status)) {
      return res.status(400).json({ success: 'failed', msg: 'Status must be enable or disable' });
    }

    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({ success: 'failed', msg: 'Bank not found' });
    }

    bank.status = status;
    await bank.save();

    res.json({ success: true, msg: 'Bank status updated by admin', bank });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to update bank status', error: err.message });
  }
};
