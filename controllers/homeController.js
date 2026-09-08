const Payout = require('../models/Payout');
const Bank = require('../models/Bank');
const { getCurrentBalance, toNum } = require('../utils/helpers');
const { getExchangeRate, getInrBonus, getTelegram } = require('../services/configService');

function summarizeSells(groups) {
  const out = {
    pending: { amt: 0, count: 0 },
    success: { amt: 0, count: 0 },
  };
  for (const g of groups || []) {
    if (g._id !== 'pending' && g._id !== 'success') continue;
    const amt = toNum(g.amt) || 0;
    out[g._id] = {
      amt: Math.round(amt * 100) / 100,
      count: g.count || 0,
    };
  }
  return out;
}

async function getSellStats(userId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await Payout.aggregate([
    { $match: { user: userId } },
    {
      $facet: {
        total: [{ $group: { _id: '$status', amt: { $sum: '$amount' }, count: { $sum: 1 } } }],
        today: [
          { $match: { createdAt: { $gte: startOfToday } } },
          { $group: { _id: '$status', amt: { $sum: '$amount' }, count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const f = rows[0] || {};
  return {
    todaySell: summarizeSells(f.today),
    totalSell: summarizeSells(f.total),
  };
}

async function getBankStats(userId) {
  const rows = await Bank.aggregate([
    { $match: { user: userId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        enabled: { $sum: { $cond: [{ $eq: ['$status', 'enable'] }, 1, 0] } },
      },
    },
  ]);
  const r = rows[0];
  return {
    totalBanksCount: r ? r.total : 0,
    enabledCount: r ? r.enabled : 0,
  };
}

exports.getHome = async (req, res) => {
  try {
    const [balance, sell, banks, exchangeRate, inrBonus, telegram] = await Promise.all([
      getCurrentBalance(req.user.userId),
      getSellStats(req.user.userId),
      getBankStats(req.user.userId),
      getExchangeRate(),
      getInrBonus(),
      getTelegram(),
    ]);

    res.json({
      success: true,
      data: {
        balance,
        userId: req.user.userid,
        mobile: req.user.mobile,
        ...sell,
        telegram,
        paymentConfig: { exchangeRate, inrBonus },
        tools: banks,
      },
    });
  } catch (err) {
    res.status(500).json({ success: 'failed', msg: 'Failed to fetch home data' });
  }
};