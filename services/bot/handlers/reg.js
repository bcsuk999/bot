const botGroupService = require('../../botGroupService');
const { formatInr, formatIst, label } = require('../format');
const { helpText } = require('./help');
const logger = require('../../../utils/logger');

// /reg is member creation. The row it writes is the member, keyed on groupId.
async function cmdReg(ctx) {
  const { chat, from } = ctx;

  const { group: member, alreadyRegistered, blocked } = await botGroupService.registerGroup({
    groupId: chat.id,
    title: chat.title,
    username: chat.username,
    type: chat.type,
    registeredBy: from?.id ?? null,
    registeredByUsername: from?.username || '',
  });

  if (blocked) {
    return { text: '🚫 This group is blocked. Contact the owner.', shouldAlert: true, reason: 'banned_group' };
  }

  const balance = await botGroupService.getGroupBalance(member._id);

  const text = [
    alreadyRegistered ? '✅ Group Already Registered' : '✅ Group Registered',
    '',
    `${label('Group ID')}     : ${member.groupId}`,
    `${label('Group Title')}  : ${member.title || '-'}`,
    `${label('Balance')}      : ${formatInr(balance)}`,
    `${label('Registered At')}: ${formatIst(member.createdAt)}`,
    `${label('Registered By')}: ${from?.username ? `@${from.username} (${from.id})` : from?.id || '-'}`,
    '',
    helpText(),
  ].join('\n');

  logger.info({ groupId: member.groupId, alreadyRegistered }, 'bot: /reg');
  return { text };
}

module.exports = { cmdReg };
