const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../db/conn');

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    
    const admin = await User.findOne({ mobile, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign({ userId: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    
    res.json({ message: 'Admin login successful', token, user: { id: admin._id, mobile: admin.mobile, role: admin.role, status: admin.status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to login admin' });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { userid } = req.params;
    const { status } = req.body;
    
    if (!['active', 'ban', 'suspend'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const user = await User.findOne({ userid: parseInt(userid) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.status = status;
    await user.save();
    
    res.json({ message: 'User status updated successfully', user: { id: user._id, mobile: user.mobile, status: user.status } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user status' });
  }
};