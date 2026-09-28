const { getGroupStats, getGroupOrderCounts, renderStatsReport } = require('../stats');
const botGroupService = require('../../botGroupService');

// /daily reports THAT group's stats. Today (IST) is the headline block,
// all-time is context. Optional arg: `today` or `all` for a single block.
async function cmdDaily(ctx) {
  const { group, args } = ctx;
  const arg = (args[0] || '').toLowerCase();
  const window = arg === 'today' ? 'today' : arg === 'all' ? 'all' : 'both';

  const [today, all, balance] = await Promise.all([
    getGroupStats(group._id, 'today'),
    getGroupStats(group._id, 'all'),
    botGroupService.getGroupBalance(group._id),
  ]);

  return {
    text: renderStatsReport({
      groupId: group.groupId,
      title: group.title,
      today,
      all,
      balance,
      window,
    }),
  };
}

// kept for callers that only need the counts
async function orderCounts(groupId) {
  return getGroupOrderCounts(groupId);
}

module.exports = { cmdDaily, orderCounts };
