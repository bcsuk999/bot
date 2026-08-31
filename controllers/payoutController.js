const User = require('../models/User');
const Bank = require('../models/Bank');

exports.togglePayoutStatus = async (req, res) => {
  try {
    const { payoutEnabled } = req.body;

    if (typeof payoutEnabled !== 'boolean') {
      return res.status(400).json({ success: 'failed', msg: 'payoutEnabled must be boolean' });
    }

    if (payoutEnabled) {
      const activeBank = await Bank.findOne({ user: req.user.userId, status: 'enable' }).lean();
      if (!activeBank) {
        return res.status(400).json({ success: 'failed', msg: 'Add and enable a bank account first' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { payoutEnabled },
      { new: true }
    );

    return res.json({
      success: true,
      msg: payoutEnabled ? 'Payout enabled' : 'Payout disabled',
      payoutEnabled: user.payoutEnabled,
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to update payout status' });
  }
};
