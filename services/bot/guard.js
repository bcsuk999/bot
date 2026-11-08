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
 * Best-effort deep link that opens the offending chat.
 *
 * - A public group can be opened by its username: https://t.me/<username>
 * - A supergroup can be opened by id: https://t.me/c/<id without -100 prefix>
 * - A basic group (negative id that is not -100...) has NO id deep link, so null.
 */
function chatDeepLink(chat = {}) {
  const username = typeof chat.username === 'string' ? chat.username.trim() : '';
  if (username) return `https://t.me/${username}`;

  const id = chat.id;
  if (id == null) return null;
  const raw = String(id);
  if (!raw.startsWith('-100') || raw.length <= 4) return null;
  return `https://t.me/c/${raw.slice(4)}`;
}

/**
 * Headline for an owner alert.
 *
 * The same alert channel is used for access denials and for payment gateway
 * failures, so title it with what actually happened instead of always claiming
 * an unauthorised access.
 */
function alertTitle(reason = '') {
  if (String(reason).startsWith('gateway_')) return '⚠️ Payment gateway error';
  return 'Unauthorized bot access';
}

/**
 * DM the owner about an unauthorised command or a gateway failure. Reports BOTH
 * the offending chat id and the user id, as required. Best-effort: never throws
 * into the command path.
 */
async function alertOwner(ctx = {}, reason, config = {}, client = null) {
  const { from = {}, chat = {}, command = '' } = ctx;
  if (!client || !config.ownerId) return false;

  const title = alertTitle(reason);

  const text = [
    title,
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
    const buttons = [];
    if (from.id != null) {
      buttons.push({ text: '💬 Message user', url: `tg://user?id=${from.id}` });
    }

    // Tap-to-open the offending chat. Only possible for a public group (username)
    // or a supergroup (-100 id); a basic group has no id deep link.
    const chatLink = chatDeepLink(chat);
    if (chatLink) {
      buttons.push({ text: '👥 Open group', url: chatLink });
    }

    if (buttons.length) {
      options.reply_markup = { inline_keyboard: [buttons] };
    }

    await client.sendMessage(config.ownerId, text, options);
    logger.warn(
      { chatId: chat.id, userId: from.id, command, reason, title },
      'bot: owner alert sent'
    );
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

module.exports = {
  DENY,
  isOwner,
  resolveAuthority,
  alertTitle,
  alertOwner,
  enforce,
  shouldAlert,
  pruneAlertCache,
  resetAlertCache,
  chatDeepLink,
};
