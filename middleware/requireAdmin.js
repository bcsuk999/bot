module.exports = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: 'failed', msg: 'Forbidden: Admin access required' });
  }
  next();
};
