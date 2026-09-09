const User = require('../models/User');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('../db/conn');
const logger = require('../utils/logger');
const { getPagination } = require('../utils/helpers');
const passwordService = require('../services/passwordService');

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ success: 'failed', msg: 'Mobile and password are required' });
    }
    
    // Use mobile unique index (fastest) + lean, then check role in JS
    const admin = await User.findOne({ mobile }).lean();
    if (!admin || admin.role !== 'admin') {
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
    const { status, remark } = req.body;
    
    if (!['active', 'ban', 'suspend'].includes(status)) {
      return res.status(400).json({ success: 'failed', msg: 'Invalid status value' });
    }

    if (!remark || !String(remark).trim()) {
      return res.status(400).json({ success: 'failed', msg: 'remark is required (e.g. reason for status change)' });
    }

    const user = await User.findOne({ userid: parseInt(userid) });
    if (!user) {
      return res.status(404).json({ success: 'failed', msg: 'User not found' });
    }

    user.status = status;
    user.remark = String(remark).trim();
    await user.save();
    
    res.json({ success: true, msg: 'User status updated successfully', user: { id: user._id, mobile: user.mobile, status: user.status, remark: user.remark } });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to update user status' });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const { uid, mobile, sortBalance, from, to, page = 1, limit = 20 } = req.query;

    const userFilter = { role: 'user' };
    if (uid) {
      const parsed = parseInt(uid, 10);
      if (!isNaN(parsed)) userFilter.userid = parsed;
    }
    if (mobile) userFilter.mobile = mobile;
    if (from || to) {
      userFilter.createdAt = {};
      if (from) userFilter.createdAt.$gte = new Date(from);
      if (to) userFilter.createdAt.$lte = new Date(to);
    }

    const users = await User.find(userFilter).lean();
    const userIds = users.map((u) => u._id);

    const stats = await Transaction.aggregate([
      { $match: { user: { $in: userIds }, status: 'success' } },
      { $sort: { user: 1, createdAt: -1 } },
      {
        $group: {
          _id: '$user',
          balance: { $first: '$balanceAfter' },
          totalDeposit: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$type', 'credit'] }, { $eq: ['$note', 'payin'] }] }, '$creditedAmount', 0],
            },
          },
        },
      },
    ]);

    const statMap = {};
    stats.forEach((s) => {
      statMap[s._id.toString()] = {
        balance: s.balance != null ? parseFloat(s.balance.toString()) : 0,
        totalDeposit: s.totalDeposit != null ? parseFloat(s.totalDeposit.toString()) : 0,
      };
    });

    let result = users.map((u) => ({
      uid: u.userid,
      mobile: u.mobile,
      registerDate: u.createdAt,
      balance: statMap[u._id.toString()] ? statMap[u._id.toString()].balance : 0,
      totalDeposit: statMap[u._id.toString()] ? statMap[u._id.toString()].totalDeposit : 0,
      status: u.status,
      remark: u.remark || null,
    }));

    if (sortBalance === 'asc') result.sort((a, b) => a.balance - b.balance);
    else if (sortBalance === 'desc') result.sort((a, b) => b.balance - a.balance);

    const { pageNum, limitNum } = getPagination(page, limit);
    const total = result.length;
    const start = (pageNum - 1) * limitNum;
    const paged = result.slice(start, start + limitNum);

    return res.json({
      success: true,
      msg: 'Users fetched',
      count: total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      users: paged,
    });
  } catch (err) {
    logger.error({ err }, 'listUsers error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch users' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    await passwordService.changeOwnPassword(req.user.userId, oldPassword, newPassword);
    res.json({ success: true, msg: 'Password changed successfully' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: 'failed', msg: err.message });
    }
    logger.error({ err }, 'Admin changePassword error');
    res.status(500).json({ success: 'failed', msg: 'Failed to change password' });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const { userid } = req.params;
    const { newPassword } = req.body;
    if (!userid) {
      return res.status(400).json({ success: 'failed', msg: 'userid param is required' });
    }
    await passwordService.adminResetUserPassword(userid, newPassword);
    res.json({ success: true, msg: 'User password reset successfully' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: 'failed', msg: err.message });
    }
    logger.error({ err }, 'Admin resetUserPassword error');
    res.status(500).json({ success: 'failed', msg: 'Failed to reset user password' });
  }
};