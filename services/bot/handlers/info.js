const botGroupService = require('../../botGroupService');
const logger = require('../../../utils/logger');

const TELEGRAM_MESSAGE_LIMIT = 4096;

function getInfoMessage(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\/info(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, '').trim();
}

async function broadcastInfo(client, groupIds, text) {
  let sent = 0;
  let failed = 0;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, text);
      sent += 1;
    } catch (err) {
      failed += 1;
      logger.error({ err, groupId }, 'bot: failed to deliver owner info broadcast');
    }
  }

  return { sent, failed };
}

async function cmdInfo(ctx, activeGroupIds) {
  const text = getInfoMessage(ctx.messageText);
  if (!text) return { text: 'Usage: /info <message>' };
  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    return { text: `Message is too long. Maximum length is ${TELEGRAM_MESSAGE_LIMIT} characters.` };
  }

  const groupIds = activeGroupIds ?? await botGroupService.getActiveGroupIds();
  if (!groupIds.length) return { text: 'There are no active registered groups to notify.' };

  const { sent, failed } = await broadcastInfo(ctx.client, groupIds, text);
  return {
    text: failed
      ? `Info broadcast complete. Sent to ${sent} active group(s); failed for ${failed}.`
      : `Info broadcast sent to ${sent} active group(s).`,
  };
}

module.exports = { cmdInfo, getInfoMessage, broadcastInfo, TELEGRAM_MESSAGE_LIMIT };
