const botGroupService = require('../botGroupService');
const { enforce, DENY, isOwner } = require('./guard');
const { helpText } = require('./handlers/help');
const { cmdReg } = require('./handlers/reg');
const { cmdBalance } = require('./handlers/balance');
const {
  cmdDeposit,
  scheduleDepositExpiryEdit,
  rememberDepositMessage,
} = require('./handlers/deposit');
const { cmdDaily } = require('./handlers/daily');
const { cmdStatus } = require('./handlers/status');
const { cmdStart } = require('./handlers/start');
const { cmdInfo } = require('./handlers/info');
const { cmdHow } = require('./handlers/how');
const { cmdOspayDeposit } = require('./handlers/ospayDeposit');
const { sendProcessingMessage, sendProcessingReply } = require('./reply');
const logger = require('../../utils/logger');

// Commands that need a registered group with active status.
const GROUP_COMMANDS = new Set(['/balance', '/d', '/osd', '/daily', '/status']);
const ALL_COMMANDS = new Set([
  '/start',
  '/reg',
  '/balance',
  '/d',
  '/osd',
  '/daily',
  '/status',
  '/info',
  '/how',
]);
const REG_OWNER_ONLY = 'Only the bot owner can register a group. Ask the owner to run /reg here.';

// The "/" menus Telegram renders per chat scope (Bot API setMyCommands).
// /reg is absent from the group menu on purpose: a normal group member must not
// be told that registration exists. It is advertised only in the owner's DM.
const GROUP_MENU = [
  { command: 'start', description: 'Show bot info and command list' },
  { command: 'balance', description: 'Show this group balance' },
  { command: 'd', description: 'Create a deposit: /d <amount>' },
  { command: 'how', description: 'How to create a deposit and use the bot' },
  { command: 'status', description: 'Check a deposit: /status <order id>' },
  { command: 'daily', description: 'Show deposit success rates' },
];

function getGroupAccessDenial(command, group) {
  if (GROUP_COMMANDS.has(command) && !group) return DENY.NOT_REGISTERED;
  if (!group || group.status === 'active') return null;
  if (group.status === 'banned') return DENY.BANNED;
  if (group.status === 'suspended') return DENY.SUSPENDED;
  return DENY.INACTIVE;
}

function getRegistrationDenial(from, config) {
  return isOwner(from, config) ? null : REG_OWNER_ONLY;
}

const OWNER_MENU = [
  { command: 'start', description: 'Show bot info and command list' },
  { command: 'reg', description: 'Register a group (run it inside the group)' },
  { command: 'info', description: 'Send a message to all active groups' },
  { command: 'how', description: 'How to create a deposit and use the bot' },
];

/**
 * Register the Telegram command menus shown when a user types "/".
 *
 * - all_group_chats: group menu, no /reg
 * - owner's private chat: owner menu, with /reg
 *
 * Best-effort: menus are cosmetic, so a failure is logged, never thrown. The
 * owner scope also needs the owner to have started the bot at least once, or
 * Telegram answers "chat not found".
 */
async function setupCommandMenus(client, config) {
  const calls = [
    ['all_group_chats', client.setMyCommands(GROUP_MENU, { scope: { type: 'all_group_chats' } })],
  ];
  if (config?.ownerId) {
    calls.push([
      'owner_private',
      client.setMyCommands(OWNER_MENU, { scope: { type: 'chat', chat_id: config.ownerId } }),
    ]);
  }

  const results = await Promise.allSettled(calls.map(([, promise]) => promise));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.warn(
        { scope: calls[i][0], msg: result.reason?.message },
        'bot: failed to set command menu'
      );
    }
  });

  return results.every((result) => result.status === 'fulfilled');
}

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
  const ctx = { chat, from, args: parsed?.args || [], command, client, config, messageText: msg.text };
  const processingMessage = parsed ? await sendProcessingMessage(client, chat.id) : null;
  const reply = (text, options) =>
    sendProcessingReply(client, chat.id, processingMessage, text, options);

  // 1. Restrict private chats and alert the owner when needed.
  const decision = await enforce(ctx, config, client);
  if (!decision.allowed) {
    const text = decision.reason === 'dm_not_allowed' ? DENY.DM_NOT_ALLOWED : DENY.NOT_AUTHORISED;
    return reply(text);
  }

  const isOwnerDm = chat.type === 'private' && decision.reason === 'owner';

  // 2. Unknown command -> help. Non-command DMs from the owner -> help hint.
  if (!parsed || parsed.unknown) {
    return reply(helpText({ isOwner: isOwnerDm }));
  }

  // 3. Private chats are owner-only (guard above). A wallet belongs to a group,
  // so group commands cannot run here; /reg in DM only points at the group.
  if (chat.type === 'private') {
    if (command === '/start') {
      return reply(
        ['This bot works inside groups.', '', helpText({ isOwner: true })].join('\n')
      );
    }
    if (command === '/reg') {
      return reply(
        'Run /reg inside the group you want to register. A wallet belongs to the group, not to a person.'
      );
    }
    if (command === '/info') {
      try {
        const result = await cmdInfo(ctx);
        return reply(result.text);
      } catch (err) {
        logger.error({ err, userId: from.id }, 'bot: info broadcast failed');
        return reply('Unable to send the info broadcast. Please try again.');
      }
    }
    if (command === '/how') {
      return reply(cmdHow().text);
    }
    return reply('Group commands must be run inside an authorised group.');
  }

  if (command === '/info') {
    return reply('Run /info in the bot private chat to notify active registered groups.');
  }

  if (command === '/reg') {
    const registrationDenial = getRegistrationDenial(from, config);
    if (registrationDenial) return reply(registrationDenial);
  }

  let result;
  try {
    // 4. The group is the member; groupId is the only identity. Every group
    // command is scoped to this record, regardless of which member sent it.
    const group = await botGroupService.getGroupByGroupId(chat.id);
    const isRegistered = !!group;
    const groupAccessDenial = getGroupAccessDenial(command, group);
    if (groupAccessDenial) return reply(groupAccessDenial);

    ctx.group = group;
    ctx.isRegistered = isRegistered;

    // 5. Dispatch.
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
      case '/d':
        result = await cmdDeposit(ctx);
        break;
      case '/osd':
        if (!isOwner(from, config)) {
          return reply('Only the bot owner can use this command.');
        }
        result = await cmdOspayDeposit(ctx);
        break;
      case '/daily':
        result = await cmdDaily(ctx);
        break;
      case '/status':
        result = await cmdStatus(ctx);
        break;
      case '/how':
        result = cmdHow();
        break;
      default:
        return reply(helpText());
    }
  } catch (err) {
    logger.error({ err, command, chatId: chat.id, userId: from.id }, 'bot: command failed');
    return reply('Something went wrong. Please try again.');
  }

  if (result?.shouldAlert) {
    const { alertOwner } = require('./guard');
    await alertOwner(ctx, result.reason || 'blocked', config, client);
  }

  const sent = await reply(result.text, result.options || {});

  // Remember the slip's message id so a webhook settlement can edit it in place.
  if (result?.orderId && sent?.message_id != null) {
    await rememberDepositMessage(result.orderId, sent.message_id);
  }

  // The deposit slip is edited to its expired notice after 20 minutes. This is a
  // Telegram message update only - the order's real status is never changed.
  if (result?.expiresAt) {
    scheduleDepositExpiryEdit({
      client,
      chatId: chat.id,
      message: sent,
      orderId: result.orderId,
      expiresAt: result.expiresAt,
      expiredReply: result.expiredReply,
    });
  }

  return sent;
}

function register(client, config) {
  client.on('message', (msg) => {
    handleMessage(msg, client, config).catch((err) =>
      logger.error({ err }, 'bot: unhandled message error')
    );
  });
  return true;
}

module.exports = {
  register,
  handleMessage,
  parseCommand,
  setupCommandMenus,
  GROUP_MENU,
  OWNER_MENU,
  GROUP_COMMANDS,
  ALL_COMMANDS,
  getGroupAccessDenial,
  getRegistrationDenial,
};
