const logger = require('../../utils/logger');
const { formatIst, escapeHtmlAll } = require('./format');

const DENY = {
  NOT_AUTHORISED: 'This chat is not authorised to use this bot.',
  DM_NOT_ALLOWED: 'This bot is for authorised groups only.',
  BANNED: 'This group is banned. Please contact support for further help.',
  SUSPENDED: 'This group is suspended. Please contact support for further help.',
  NOT_REGISTERED: 'This group is not registered yet. Run /reg first.',
};

// Simple TTL set for alert de-duplication: a spamming group must not flood the
// owner's DM. key -> timestamp
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

/**
 * Decide whether a chat may run bot commands.
 *
 * Order: owner bypass -> private chat deny -> allowlist -> deny.
 * The allowlist is the authority; /reg is what creates the wallet. It is
 * optional: when no ids/usernames are configured every group is allowed and
 * only private DMs are refused.
 *
 * @param {object} ctx  { from, chat, command }
 * @param {object} config
 * @returns {{ allowed: boolean, reason: string, alert: boolean }}
 */
function resolveAuthority(ctx = {}, config = {}) {
  const { from = {}, chat = {}, command = '' } = ctx;
  const ownerId = config.ownerId;

  if (ownerId && from.id != null && Number(from.id) === Number(ownerId)) {
    return { allowed: true, reason: 'owner', alert: false };
  }

  const isPrivate = chat.type === 'private';
  if (isPrivate) {
    return { allowed: false, reason: 'dm_not_allowed', alert: true };
  }

  const allowlistEmpty =
    (!(config.allowedGroupIds instanceof Set) || config.allowedGroupIds.size === 0) &&
    (!(config.allowedGroupUsernames instanceof Set) || config.allowedGroupUsernames.size === 0);

  // No allowlist configured: the bot is open to every group.
  if (allowlistEmpty) {
    return { allowed: true, reason: 'open_allowlist', alert: false };
  }

  if (chat.id != null && config.allowedGroupIds instanceof Set && config.allowedGroupIds.has(String(chat.id))) {
    return { allowed: true, reason: 'allowlisted_chat', alert: false };
  }

  return { allowed: false, reason: 'chat_not_allowlisted', alert: true };
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
    await client.sendMessage(config.ownerId, text, { parse_mode: 'HTML' });
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

module.exports = { DENY, resolveAuthority, alertOwner, enforce, shouldAlert, pruneAlertCache, resetAlertCache };
