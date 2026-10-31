const botGroupService = require('../../botGroupService');
const { formatInr, label } = require('../format');
const { helpText } = require('./help');

async function cmdStart(ctx) {
  const { group, isRegistered } = ctx;

  if (isRegistered && group) {
    const balance = await botGroupService.getGroupBalance(group._id);
    return {
      text: [
        '👋 This group is registered.',
        '',
        `${label('Group ID')}: ${group.groupId}`,
        `${label('Balance')}  : ${formatInr(balance)}`,
        '',
        helpText(),
      ].join('\n'),
    };
  }

  return { text: `👋 This group is authorised.\n\nRun /reg to create its wallet.\n\n${helpText()}` };
}

module.exports = { cmdStart };
