const logger = require('../../utils/logger');
const { formatIst, escapeHtmlAll } = require('./format');

const DENY = {
  NOT_AUTHORISED: 'This chat is not authorised to use this bot.',
  DM_NOT_ALLOWED: 'This bot is for authorised groups only.',
  BANNED: 'This group is banned. Please contact support for further help.',
  SUSPENDED: 'This group is suspended. Please contact support for further help.',
  INACTIVE: 'This group is not active. Please contact support for further help.',
  NOT_REGISTERED: 'This group is not registered yet. Run /reg first.',
};

// Simple TTL set for alert de-duplication. key -> timestamp
const alertSeen = new Map();

function shouldAlert(key, ttlMs, now = Date.now()) {
  const last = alertSeen.get(key);
  if (last != null && now - last < ttlMs) return false;
  alertSeen.set(key, now);
  return true;
}

function pruneAlertCache(ttlMs, now = Date.now()) {
  for (const [key, ts] of alertSeen) {
    if (now - ts >= ttlMs) alertSeen.delete(key);
  }
}

// Test hook: clear all dedupe state.
function resetAlertCache() {
  alertSeen.clear();
}

function isOwner(from = {}, config = {}) {
  return Boolean(
    config.ownerId &&
    from.id != null &&
    Number(from.id) === Number(config.ownerId)
  );
}

/**
 * Decide whether a chat may run bot commands.
 *
 * Private chats are owner-only. Group membership is authorized later by the
 * registered TelegramGroup record, keyed by chat id, not by an env allowlist
 * or the individual sender's Telegram id.
 *
 * @param {object} ctx  { from, chat, command }
 * @param {object} config
 * @returns {{ allowed: boolean, reason: string, alert: boolean }}
 */
function resolveAuthority(ctx = {}, config = {}) {
  const { from = {}, chat = {} } = ctx;

  if (isOwner(from, config)) {
    return { allowed: true, reason: 'owner', alert: false };
  }

  const isPrivate = chat.type === 'private';
  if (isPrivate) {
    return { allowed: false, reason: 'dm_not_allowed', alert: true };
  }

  return { allowed: true, reason: 'group_chat', alert: false };
}

/**
 * DM the owner about an unauthorised command. Reports BOTH the offending chat id
 * and the user id, as required. Best-effort: never throws into the command path.
 */
async function alertOwner(ctx = {}, reason, config = {}, client = null) {
  const { from = {}, chat = {}, command = '' } = ctx;
  if (!client || !config.ownerId) return false;

  const text = [
    'Unauthorized bot access',
    '',
    `Chat ID: ${escapeHtmlAll(chat.id ?? '-')}`,
    `Chat type: ${escapeHtmlAll(chat.type ?? '-')}`,
    `Chat title: ${escapeHtmlAll(chat.title || '-')}`,
    `Chat username: ${escapeHtmlAll(chat.username || '-')}`,
    `User ID: ${escapeHtmlAll(from.id ?? '-')}`,
    `Username: ${escapeHtmlAll(from.username || '-')}`,
    `First name: ${escapeHtmlAll(from.first_name || '-')}`,
    `Command: ${escapeHtmlAll(command || '-')}`,
    `Reason: ${escapeHtmlAll(reason)}`,
    `Time (IST): ${formatIst()}`,
  ].join('\n');

  try {
    const options = { parse_mode: 'HTML' };

    // Tap-to-DM the offending user. `tg://user?id=` works even when the account
    // has no public username; if the user restricts DMs Telegram shows the
    // profile instead of opening the chat.
    if (from.id != null) {
      options.reply_markup = {
        inline_keyboard: [[{ text: '💬 Message user', url: `tg://user?id=${from.id}` }]],
      };
    }

    await client.sendMessage(config.ownerId, text, options);
    logger.warn({ chatId: chat.id, userId: from.id, command, reason }, 'bot: alerted owner about unauthorised access');
    return true;
  } catch (err) {
    logger.error({ err, chatId: chat.id, userId: from.id }, 'bot: failed to alert owner');
    return false;
  }
}

/**
 * Run the guard for an inbound message: resolve authority, alert the owner when
 * required (de-duplicated), and return the decision.
 */
async function enforce(ctx = {}, config = {}, client = null) {
  const decision = resolveAuthority(ctx, config);

  if (decision.alert) {
    pruneAlertCache(config.alertDedupeMs);
    const key = `${ctx.chat?.id}|${ctx.from?.id}|${ctx.command}`;
    if (shouldAlert(key, config.alertDedupeMs)) {
      await alertOwner(ctx, decision.reason, config, client);
    } else {
      logger.warn({ key }, 'bot: suppressed duplicate owner alert');
    }
  }

  return decision;
}

module.exports = { DENY, isOwner, resolveAuthority, alertOwner, enforce, shouldAlert, pruneAlertCache, resetAlertCache };
