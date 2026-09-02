const User = require('../models/User');
const Bank = require('../models/Bank');

exports.getPayoutSwitch = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).lean();
    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }
    return res.json({
      success: true,
      withdrawal: user.withdrawal || false,
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to get payout switch' });
  }
};

exports.togglePayoutStatus = async (req, res) => {
  try {
    const { withdrawal } = req.body;

    if (typeof withdrawal !== 'boolean') {
      return res.status(400).json({ success: 'failed', msg: 'withdrawal must be boolean' });
    }

    if (withdrawal) {
      const activeBank = await Bank.findOne({ user: req.user.userId, status: 'enable' }).lean();
      if (!activeBank) {
        return res.status(400).json({ success: 'failed', msg: 'Add and enable a bank account first' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { withdrawal },
      { new: true }
    );

    return res.json({
      success: true,
      msg: withdrawal ? 'Payout enabled' : 'Payout disabled',
      withdrawal: user.withdrawal,
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to update payout switch' });
  }
};
