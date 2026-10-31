const botGroupService = require('../../botGroupService');
const { formatInr } = require('../format');
const { helpText } = require('./help');

async function cmdStart(ctx) {
  const { group, isRegistered } = ctx;

  if (isRegistered && group) {
    const balance = await botGroupService.getGroupBalance(group._id);
    return {
      text: [
        'Group registered',
        '',
        `Group ID: ${group.groupId}`,
        `Balance: ${formatInr(balance)}`,
        '',
        helpText(),
      ].join('\n'),
    };
  }

  return { text: `This group is authorised. Run /reg to create its wallet.\n\n${helpText()}` };
}

module.exports = { cmdStart };
