const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../db/conn');

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    
    const admin = await User.findOne({ mobile, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ success: 'failed', msg: 'Admin not found' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ userId: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    
    res.json({ success: true, msg: 'Admin login successful', token, user: { id: admin._id, mobile: admin.mobile, role: admin.role, status: admin.status } });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to login admin' });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { userid } = req.params;
    const { status } = req.body;
    
    if (!['active', 'ban', 'suspend'].includes(status)) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid status value' });
    }

    const user = await User.findOne({ userid: parseInt(userid) });
    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }

    user.status = status;
    await user.save();
    
    res.json({ success: true, msg: 'User status updated successfully', user: { id: user._id, mobile: user.mobile, status: user.status } });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to update user status' });
  }
};