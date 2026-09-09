const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: 'failed', msg: 'Unauthorized: No token provided' });
    }

    const token = header.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: 'failed', msg: 'Unauthorized: Invalid token format' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('_id userid role mobile status withdrawal').lean();
    if (!user) {
      return res.status(401).json({ success: 'failed', msg: 'Unauthorized: User not found' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: 'failed', msg: `Access denied: User is ${user.status}` });
    }

    req.user = {
      userId: user._id,
      userid: user.userid,
      role: user.role,
      mobile: user.mobile,
      withdrawal: user.withdrawal || false,
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: 'failed', msg: 'Unauthorized: Invalid or expired token' });
    }
    return res.status(500).json({ success: 'failed', msg: 'Auth failed' });
  }
};

module.exports = auth;
