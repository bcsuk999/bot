const logger = require('../../utils/logger');

const DEFAULT_MIN_DEPOSIT = 100;
const DEFAULT_MAX_DEPOSIT = 100000;
const DEFAULT_ALERT_DEDUPE_MS = 5 * 60 * 1000;

function parsePositiveNumber(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    logger.warn({ value: raw }, 'bot config: expected a positive number, using default');
    return fallback;
  }
  return n;
}

// Legacy TELEGRAM_ALLOWED_GROUP_IDS setting, retained for compatibility and
// health reporting only. Group commands are authorized by registered DB state.
function parseAllowlist(raw) {
  const ids = new Set();
  const usernames = new Set();
  const invalid = [];

  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      if (entry.startsWith('@')) {
        usernames.add(entry);
        return;
      }
      // Telegram group/supergroup ids are negative; user ids are positive.
      if (/^-?\d+$/.test(entry)) {
        ids.add(entry);
        return;
      }
      invalid.push(entry);
    });

  if (invalid.length) {
    logger.warn({ invalid }, 'bot config: ignoring malformed TELEGRAM_ALLOWED_GROUP_IDS entries');
  }
  return { ids, usernames, invalid };
}

/**
 * SimplyPay order status codes that mean "this payment has expired".
 *
 * These are NOT hardcoded on purpose. services/simplypay.apidoc.md documents
 * 0, 1 and -4 as PENDING, and documents no expired code at all, while the
 * gateway is the only thing allowed to expire an order. Guessing wrong here
 * marks a live payment expired, and the deposit is then never credited.
 *
 * So the default is empty: an unknown code leaves the order pending, which is
 * recoverable. Set SIMPLYPAY_EXPIRED_STATUSES to the real code(s) once confirmed
 * with the gateway, e.g. "4,-5".
 */
function parseExpiredStatuses(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  const out = [];
  for (const part of String(raw).split(',')) {
    const s = part.trim();
    if (!s) continue;
    const n = Number(s);
    if (!Number.isFinite(n)) {
      logger.warn({ value: s }, 'bot config: SIMPLYPAY_EXPIRED_STATUSES has a non-numeric entry, ignoring it');
      continue;
    }
    out.push(n);
  }
  return out;
}

function loadConfig(env = process.env) {
  const allowlist = parseAllowlist(env.TELEGRAM_ALLOWED_GROUP_IDS);
  const minDeposit = parsePositiveNumber(env.BOT_MIN_DEPOSIT_AMOUNT, DEFAULT_MIN_DEPOSIT);
  const maxDeposit = parsePositiveNumber(env.BOT_MAX_DEPOSIT_AMOUNT, DEFAULT_MAX_DEPOSIT);

  const config = {
    enabled: String(env.BOT_ENABLED || '').toLowerCase() === 'true',
    token: env.TELEGRAM_BOT_TOKEN || '',
    ownerId: env.TELEGRAM_OWNER_ID ? Number(env.TELEGRAM_OWNER_ID) : null,
    ownerUsername: env.TELEGRAM_OWNER_USERNAME || '',
    botUsername: env.TELEGRAM_BOT_USERNAME || '',
    allowedGroupIds: allowlist.ids,
    allowedGroupUsernames: allowlist.usernames,
    minDeposit,
    maxDeposit,
    maxDepositLowerThanMin: maxDeposit < minDeposit,
    // Must be the bot callback (/webhook/simplypay/bot). There is deliberately no
    // fallback to SIMPLYPAY_NOTIFY_URL: that path is handled by simplypayController,
    // which looks up Payin by payinId, finds nothing, and silently drops the payment.
    botNotifyUrl: env.SIMPLYPAY_BOT_NOTIFY_URL || '',
    mode: env.BOT_MODE === 'webhook' ? 'webhook' : 'polling',
    webhookUrl: env.BOT_WEBHOOK_URL || '',
    webhookSecret: env.BOT_WEBHOOK_SECRET || '',
    alertDedupeMs: parsePositiveNumber(env.BOT_ALERT_DEDUPE_MS, DEFAULT_ALERT_DEDUPE_MS),
    expiredStatuses: parseExpiredStatuses(env.SIMPLYPAY_EXPIRED_STATUSES),
  };

  if (config.maxDepositLowerThanMin) {
    logger.error(
      { min: config.minDeposit, max: config.maxDeposit },
      'bot config: BOT_MAX_DEPOSIT_AMOUNT is below BOT_MIN_DEPOSIT_AMOUNT - every deposit will be rejected'
    );
  }

  return config;
}

// Returns null when config is safe to start, or an array of fatal problems.
function validateConfig(config) {
  const problems = [];
  if (!config.enabled) return problems;
  if (!config.token) problems.push('TELEGRAM_BOT_TOKEN is missing');
  if (!config.ownerId || !Number.isFinite(config.ownerId)) problems.push('TELEGRAM_OWNER_ID is missing or not a number');
  // TELEGRAM_ALLOWED_GROUP_IDS is legacy and does not control group access.
  if (config.maxDepositLowerThanMin) problems.push('BOT_MAX_DEPOSIT_AMOUNT is below BOT_MIN_DEPOSIT_AMOUNT');
  if (!config.botNotifyUrl) {
    problems.push('SIMPLYPAY_BOT_NOTIFY_URL is missing - group deposits could never be settled');
  } else if (!/\/webhook\/simplypay\/bot\/?(\?|$)/.test(config.botNotifyUrl)) {
    problems.push('SIMPLYPAY_BOT_NOTIFY_URL must point at /webhook/simplypay/bot');
  }
  if (config.mode === 'webhook' && !config.webhookUrl) problems.push('BOT_MODE=webhook requires BOT_WEBHOOK_URL');
  // Without this the update endpoint would let anyone POST forged Telegram
  // updates and run /reg or /deposit as any chat.
  if (config.mode === 'webhook' && !config.webhookSecret) {
    problems.push('BOT_MODE=webhook requires BOT_WEBHOOK_SECRET');
  }
  return problems;
}

module.exports = {
  loadConfig,
  validateConfig,
  parseAllowlist,
  parsePositiveNumber,
  parseExpiredStatuses,
  DEFAULT_MIN_DEPOSIT,
  DEFAULT_MAX_DEPOSIT,
  DEFAULT_ALERT_DEDUPE_MS,
};
