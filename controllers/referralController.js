const User = require('../models/User');
const Commission = require('../models/Commission');
const Payin = require('../models/Payin');
const { getPagination } = require('../utils/helpers');

function toNum(v) {
  if (v == null) return 0;
  const n = Number(v && v.toString ? v.toString() : v);
  return isNaN(n) ? 0 : n;
}

function maskMobile(m) {
  if (!m) return null;
  const s = String(m);
  if (s.length <= 6) return s;
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

exports.getReferralInfo = async (req, res) => {
  try {
    const referralCount = await User.countDocuments({ referredBy: req.user.userId });

    const commissions = await Commission.aggregate([
      { $match: { referrer: req.user.userId, status: 'success' } },
      { $group: { _id: null, totalEarned: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
    ]);

    const totalEarned = commissions.length ? toNum(commissions[0].totalEarned) : 0;
    const commissionCount = commissions.length ? commissions[0].count : 0;

    res.json({
      success: true,
      msg: 'Referral info fetched',
      inviteCode: req.user.userid,
      referralCount,
      commissionCount,
      totalEarned,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch referral info' });
  }
};

exports.getReferralList = async (req, res) => {
  try {
    const { pageNum, limitNum, skip } = getPagination(req.query.page, req.query.limit);
    const { month } = req.query;

    const query = { referredBy: req.user.userId };
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [y, m] = String(month).split('-').map(Number);
      if (m >= 1 && m <= 12) {
        query.createdAt = {
          $gte: new Date(Date.UTC(y, m - 1, 1)),
          $lt: new Date(Date.UTC(y, m, 1)),
        };
      }
    }

    const [count, referrals] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('mobile userid createdAt')
        .lean(),
    ]);

    const userids = referrals.map((r) => r.userid).filter(Boolean);
    let depositTotals = {};
    if (userids.length) {
      const rows = await Payin.aggregate([
        { $match: { userid: { $in: userids }, status: 'success' } },
        { $group: { _id: '$userid', total: { $sum: '$amount' } } },
      ]);
      for (const r of rows) depositTotals[r._id] = toNum(r.total);
    }

    res.json({
      success: true,
      msg: 'Referral list fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      referrals: referrals.map((r) => ({
        mobile: maskMobile(r.mobile),
        totaldepositamt: depositTotals[r.userid] || 0,
        regat: r.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch referral list' });
  }
};

exports.getMyCommissions = async (req, res) => {
  try {
    const { pageNum, limitNum, skip } = getPagination(req.query.page, req.query.limit);

    const [count, commissions] = await Promise.all([
      Commission.countDocuments({ referrer: req.user.userId, status: 'success' }),
      Commission.find({ referrer: req.user.userId, status: 'success' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('referee commissionAmount createdAt')
        .populate('referee', 'mobile')
        .lean(),
    ]);

    res.json({
      success: true,
      msg: 'Commission list fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      commissions: commissions.map((c) => ({
        refreeemobile: maskMobile(c.referee && c.referee.mobile),
        commissionAmount: toNum(c.commissionAmount),
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch commissions' });
  }
};