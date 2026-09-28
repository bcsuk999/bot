const botGroupService = require('../../botGroupService');
const { getGroupOrderCounts } = require('../stats');
const { formatInr, label } = require('../format');

async function cmdBalance(ctx) {
  const { group } = ctx;
  const [balance, counts] = await Promise.all([
    botGroupService.getGroupBalance(group._id),
    getGroupOrderCounts(group._id),
  ]);

  return {
    text: [
      '💰 Group Balance',
      '',
      `${label('Group ID')}         : ${group.groupId}`,
      `${label('Balance')}          : ${formatInr(balance)}`,
      `${label('Total Credited')}   : ${formatInr(group.totalCredited || 0)}`,
      `${label('Successful Orders')}: ${counts.success}`,
      `${label('Failed Orders')}    : ${counts.failed + counts.expired}`,
      `${label('Pending Orders')}   : ${counts.pending}`,
    ].join('\n'),
  };
}

module.exports = { cmdBalance };
