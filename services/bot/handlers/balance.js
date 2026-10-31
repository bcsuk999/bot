const botGroupService = require('../../botGroupService');
const { getGroupOrderCounts } = require('../stats');
const { formatInr } = require('../format');

async function cmdBalance(ctx) {
  const { group } = ctx;
  const [balance, counts] = await Promise.all([
    botGroupService.getGroupBalance(group._id),
    getGroupOrderCounts(group._id),
  ]);

  return {
    text: [
      'Group balance',
      '',
      `Group ID: ${group.groupId}`,
      `Balance: ${formatInr(balance)}`,
      `Total credited: ${formatInr(group.totalCredited || 0)}`,
      `Successful orders: ${counts.success}`,
      `Failed orders: ${counts.failed + counts.expired}`,
      `Pending orders: ${counts.pending}`,
    ].join('\n'),
  };
}

module.exports = { cmdBalance };
