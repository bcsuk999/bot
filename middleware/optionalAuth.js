const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * optionalAuth - allows public access but validates token if provided.
 * If Authorization: Bearer <token> is present, verifies it (401 if invalid/expired/banned).
 * If no header, proceeds without req.user.
 * Used for GET /api/user/payin/exchange so it works both logged-in and public,
 * while admin-changeable rate via DB is still respected.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next();
    }
    const token = header.split(' ')[1];
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).lean();
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
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: 'failed', msg: 'Unauthorized: Invalid or expired token' });
    }
    return next();
  }
};

module.exports = optionalAuth;
