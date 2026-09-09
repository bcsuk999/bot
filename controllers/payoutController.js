const User = require('../models/User');
const Bank = require('../models/Bank');

exports.getPayoutSwitch = async (req, res) => {
  try {
    // Optimised: auth already fetched withdrawal -> 0 DB call, was 1 extra findById
    if (req.user && typeof req.user.withdrawal === 'boolean') {
      return res.json({ success: true, withdrawal: req.user.withdrawal });
    }
    const user = await User.findById(req.user.userId).select('withdrawal').lean();
    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }
    return res.json({ success: true, withdrawal: user.withdrawal || false });
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

    // Optimised: use exists (covered by {user:1, status:1} index) vs findOne + no payload
    if (withdrawal) {
      const hasBank = await Bank.exists({ user: req.user.userId, status: 'enable' });
      if (!hasBank) {
        return res.status(400).json({ success: 'failed', msg: 'Add and enable a bank account first' });
      }
    }

    // Optimised: projection + lean + $set, was full doc hydration with password
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: { withdrawal } },
      { returnDocument: 'after', projection: 'withdrawal' }
    ).lean();

    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }

    // Keep req.user in sync for next GET without DB
    req.user.withdrawal = user.withdrawal;

    return res.json({
      success: true,
      msg: withdrawal ? 'Payout enabled' : 'Payout disabled',
      withdrawal: user.withdrawal,
    });
  } catch (err) {
    return res.status(500).json({ success: 'failed', msg: 'Failed to update payout switch' });
  }
};
