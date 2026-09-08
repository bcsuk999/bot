const CommissionConfig = require('../models/CommissionConfig');
const Commission = require('../models/Commission');
const User = require('../models/User');
const { refreshCommissionConfig } = require('../services/configService');
const { getPagination } = require('../utils/helpers');

function toNum(v) {
  if (v == null) return 0;
  const n = Number(v && v.toString ? v.toString() : v);
  return isNaN(n) ? 0 : n;
}

exports.getCommissionConfig = async (req, res) => {
  try {
    const config = await CommissionConfig.findOne().sort({ updatedAt: -1 }).lean();
    res.json({
      success: true,
      msg: 'Commission config fetched',
      commissionPercentage: config ? config.commissionPercentage : 0,
      isActive: config ? config.isActive : false,
      updatedBy: config ? config.updatedBy : null,
      updatedAt: config ? config.updatedAt : null,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch commission config' });
  }
};

exports.updateCommissionConfig = async (req, res) => {
  try {
    const { commissionPercentage, isActive } = req.body;

    if (commissionPercentage == null) {
      return res.status(400).json({ success: 'failed', msg: 'commissionPercentage is required' });
    }

    const percentage = Number(commissionPercentage);
    if (!isFinite(percentage) || percentage < 0 || percentage > 100) {
      return res.status(400).json({ success: 'failed', msg: 'commissionPercentage must be between 0 and 100' });
    }

    let config = await CommissionConfig.findOne().sort({ updatedAt: -1 });
    if (!config) config = new CommissionConfig();
    config.commissionPercentage = percentage;
    if (isActive != null) config.isActive = Boolean(isActive);
    config.updatedBy = req.user.userId;
    await config.save();

    refreshCommissionConfig();

    res.json({
      success: true,
      msg: 'Commission config updated',
      commissionPercentage: config.commissionPercentage,
      isActive: config.isActive,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to update commission config' });
  }
};

exports.adminListCommissions = async (req, res) => {
  try {
    const { pageNum, limitNum, skip } = getPagination(req.query.page, req.query.limit);
    const { status, currency, userid } = req.query;

    const query = {};
    if (status) query.status = status;
    if (currency) query.currency = String(currency).toUpperCase();
    if (userid && !isNaN(Number(userid))) {
      query.$or = [{ referrerUserid: Number(userid) }, { refereeUserid: Number(userid) }];
    }

    const [count, commissions] = await Promise.all([
      Commission.countDocuments(query),
      Commission.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('commissionId referrerUserid refereeUserid payinId depositAmount currency commissionPercentage commissionAmount status creditedAt createdAt')
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
        referrerUserid: c.referrerUserid,
        refereeUserid: c.refereeUserid,
        payinId: c.payinId,
        depositAmount: toNum(c.depositAmount),
        currency: c.currency,
        commissionPercentage: c.commissionPercentage,
        commissionAmount: toNum(c.commissionAmount),
        status: c.status,
        creditedAt: c.creditedAt,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch commissions' });
  }
};

exports.adminReferralStats = async (req, res) => {
  try {
    const [totalReferrals, totalCommissions, joinersToday] = await Promise.all([
      User.countDocuments({ referredBy: { $ne: null } }),
      Commission.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, totalEarned: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
      ]),
      User.countDocuments({ referredBy: { $ne: null }, createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    ]);

    const totalEarned = totalCommissions.length ? toNum(totalCommissions[0].totalEarned) : 0;
    const commissionCount = totalCommissions.length ? totalCommissions[0].count : 0;

    res.json({
      success: true,
      msg: 'Referral stats fetched',
      totalReferrals,
      commissionCount,
      totalEarned,
      joinersToday,
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch referral stats' });
  }
};