const User = require('../models/User');
const Commission = require('../models/Commission');
const { getPagination } = require('../utils/helpers');

function toNum(v) {
  if (v == null) return 0;
  const n = Number(v && v.toString ? v.toString() : v);
  return isNaN(n) ? 0 : n;
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
    const { status } = req.query;

    const query = { referredBy: req.user.userId };
    if (status) query.status = status;

    const [count, referrals] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('mobile userid status createdAt')
        .lean(),
    ]);

    res.json({
      success: true,
      msg: 'Referral list fetched',
      count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      referrals,
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
        .select('commissionId refereeUserid payinId depositAmount currency commissionPercentage commissionAmount createdAt')
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
        commissionId: c.commissionId,
        refereeUserid: c.refereeUserid,
        payinId: c.payinId,
        depositAmount: toNum(c.depositAmount),
        currency: c.currency,
        commissionPercentage: c.commissionPercentage,
        commissionAmount: toNum(c.commissionAmount),
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch commissions' });
  }
};