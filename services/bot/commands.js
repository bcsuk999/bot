const botGroupService = require('../botGroupService');
const { enforce, DENY } = require('./guard');
const { HELP } = require('./handlers/help');
const { cmdReg } = require('./handlers/reg');
const { cmdBalance } = require('./handlers/balance');
const { cmdDeposit } = require('./handlers/deposit');
const { cmdDaily } = require('./handlers/daily');
const { cmdStart } = require('./handlers/start');
const logger = require('../../utils/logger');

// Commands that need an active member (a registered, non-banned group).
const GROUP_COMMANDS = new Set(['/balance', '/deposit', '/daily']);
const ALL_COMMANDS = new Set(['/start', '/reg', '/balance', '/deposit', '/daily']);

function parseCommand(text) {
  if (typeof text !== 'string' || !text.startsWith('/')) return null;
  const [rawToken, ...args] = text.trim().split(/\s+/);
  const command = rawToken.toLowerCase().split('@')[0]; // strip /cmd@botname
  if (!ALL_COMMANDS.has(command)) return { command, args, unknown: true };
  return { command, args, unknown: false };
}

async function handleMessage(msg, client, config) {
  const chat = msg.chat || {};
  const from = msg.from || {};
  const parsed = parseCommand(msg.text);

  // Ignore non-command chatter in groups so the bot stays quiet.
  if (!parsed && chat.type !== 'private') return;

  const command = parsed?.command || '';
  const ctx = { chat, from, args: parsed?.args || [], command, client, config };

  // 1. Authority - deny + owner alert for unauthorised chats.
  const decision = await enforce(ctx, config, client);
  if (!decision.allowed) {
    const text = decision.reason === 'dm_not_allowed' ? DENY.DM_NOT_ALLOWED : DENY.NOT_AUTHORISED;
    return client.sendMessage(chat.id, text);
  }

  // 2. Unknown command -> help. Non-command DMs from the owner -> help hint.
  if (!parsed || parsed.unknown) {
    return client.sendMessage(chat.id, HELP);
  }

  // 3. Member lookup. The group is the member; groupId is the only identity.
  const isOwner = decision.reason === 'owner';
  let group = null;
  let isRegistered = false;

  if (chat.type === 'private') {
    // Private chats are owner-only (handled above). /reg and /start are not
    // meaningful for a personal chat, so point the owner at the group commands.
    return client.sendMessage(chat.id, 'ℹ️ Group commands must be run inside an authorised group.');
  }

  group = await botGroupService.getGroupByGroupId(chat.id);
  isRegistered = !!group;

  if (GROUP_COMMANDS.has(command) && !isRegistered) {
    return client.sendMessage(chat.id, DENY.NOT_REGISTERED);
  }
  if (group && group.status === 'banned') {
    return client.sendMessage(chat.id, DENY.BANNED);
  }

  ctx.group = group;
  ctx.isRegistered = isRegistered;

  // 4. Dispatch.
  let result;
  try {
    switch (command) {
      case '/start':
        result = await cmdStart(ctx);
        break;
      case '/reg':
        result = await cmdReg(ctx);
        break;
      case '/balance':
        result = await cmdBalance(ctx);
        break;
      case '/deposit':
        result = await cmdDeposit(ctx);
        break;
      case '/daily':
        result = await cmdDaily(ctx);
        break;
      default:
        return client.sendMessage(chat.id, HELP);
    }
  } catch (err) {
    logger.error({ err, command, chatId: chat.id, userId: from.id }, 'bot: command failed');
    return client.sendMessage(chat.id, '❌ Something went wrong. Please try again.');
  }

  if (result?.shouldAlert) {
    const { alertOwner } = require('./guard');
    await alertOwner(ctx, result.reason || 'blocked', config, client);
  }

  return client.sendMessage(chat.id, result.text, result.options || {});
}

function register(client, config) {
  client.on('message', (msg) => {
    handleMessage(msg, client, config).catch((err) =>
      logger.error({ err }, 'bot: unhandled message error')
    );
  });
  return true;
}

module.exports = { register, handleMessage, parseCommand };
