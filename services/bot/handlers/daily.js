const { getGroupStatsSince, renderRateReport, getGroupOrderCounts } = require('../stats');
const { startOfIstDay } = require('../format');

const MINUTE = 60 * 1000;

// /daily: success rate for four windows, newest window first. All four are always
// shown so they can be read against each other - the old `today` / `all` argument
// no longer selects a single block.
async function cmdDaily(ctx) {
  const { group } = ctx;
  const now = Date.now();

  const [last10m, last30m, last1h, today] = await Promise.all([
    getGroupStatsSince(group._id, new Date(now - 10 * MINUTE)),
    getGroupStatsSince(group._id, new Date(now - 30 * MINUTE)),
    getGroupStatsSince(group._id, new Date(now - 60 * MINUTE)),
    getGroupStatsSince(group._id, startOfIstDay()),
  ]);

  return {
    text: renderRateReport([
      { label: '10 min', bucket: last10m },
      { label: '30 min', bucket: last30m },
      { label: '1 hour', bucket: last1h },
      { label: 'Today', bucket: today },
    ]),
  };
}

// kept for callers that only need the counts
async function orderCounts(groupId) {
  return getGroupOrderCounts(groupId);
}

module.exports = { cmdDaily, orderCounts };
