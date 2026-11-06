const os = require('os');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const BotLock = require('../../models/BotLock');
const { loadConfig, validateConfig } = require('./config');

// Telegram permits exactly one getUpdates consumer per bot token. A shared
// MongoDB lease makes every backend replica agree on who that consumer is, so a
// deploy that briefly runs two instances cannot produce 409 conflicts.
const POLLING_LOCK_ID = 'telegram-polling';
const POLLING_LOCK_TTL_MS = 60 * 1000;
const POLLING_LOCK_RENEW_MS = 20 * 1000;
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

let client = null;
let config = null;
let running = false;
let registered = false;
let lastError = null;
let configProblems = null;
let ownsPollingLock = false;
let lockRenewTimer = null;

function getClient() {
  return client;
}

function getConfig() {
  return config;
}

function isRunning() {
  return running;
}

async function acquirePollingLock() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POLLING_LOCK_TTL_MS);

  // Take over an expired lease, or renew one this instance already owns.
  const existing = await BotLock.findOneAndUpdate(
    { _id: POLLING_LOCK_ID, $or: [{ expiresAt: { $lte: now } }, { owner: INSTANCE_ID }] },
    { $set: { owner: INSTANCE_ID, expiresAt } },
    { new: true }
  );
  if (existing) {
    ownsPollingLock = true;
    return true;
  }

  // No lease exists yet. Two instances can race here; _id makes the loser fail
  // with a duplicate-key error instead of starting a second poller.
  try {
    await BotLock.create({ _id: POLLING_LOCK_ID, owner: INSTANCE_ID, expiresAt });
    ownsPollingLock = true;
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

async function renewPollingLock() {
  if (!ownsPollingLock) return false;
  const renewed = await BotLock.findOneAndUpdate(
    { _id: POLLING_LOCK_ID, owner: INSTANCE_ID },
    { $set: { expiresAt: new Date(Date.now() + POLLING_LOCK_TTL_MS) } },
    { new: true }
  );
  if (!renewed) ownsPollingLock = false;
  return !!renewed;
}

async function releasePollingLock() {
  if (!ownsPollingLock) return;
  ownsPollingLock = false;
  try {
    await BotLock.deleteOne({ _id: POLLING_LOCK_ID, owner: INSTANCE_ID });
  } catch (err) {
    logger.warn({ error: err?.message }, 'bot: failed to release polling lock');
  }
}

function startLockRenewal() {
  stopLockRenewal();
  lockRenewTimer = setInterval(() => {
    renewPollingLock()
      .then((ok) => {
        if (!ok) {
          logger.warn('bot: lost the Telegram polling lock - stopping this poller');
          stopBot().catch(() => {});
        }
      })
      .catch((err) => logger.warn({ error: err?.message }, 'bot: polling lock renewal failed'));
  }, POLLING_LOCK_RENEW_MS);
  // Do not keep the process alive only for the renewal timer.
  if (lockRenewTimer.unref) lockRenewTimer.unref();
}

function stopLockRenewal() {
  if (lockRenewTimer) {
    clearInterval(lockRenewTimer);
    lockRenewTimer = null;
  }
}

/**
 * Start the Telegram bot. Never throws: a bot failure must not take the HTTP
 * server down with it.
 */
async function startBot() {
  if (running) return { started: true, reason: 'already_running', mode: config?.mode };

  config = loadConfig();

  if (!config.enabled) {
    logger.info('bot: BOT_ENABLED is not true - bot not started');
    return { started: false, reason: 'disabled' };
  }

  const problems = validateConfig(config);
  if (problems.length) {
    // Surface the reason on /api/bot/health. Without this, a misconfigured
    // deployment just reports running:false with no explanation.
    configProblems = problems;
    problems.forEach((p) => logger.error({ problem: p }, 'bot: invalid configuration'));
    return { started: false, reason: 'invalid_config', problems };
  }
  configProblems = null;

  try {
    if (config.mode === 'polling') {
      const acquired = await acquirePollingLock();
      if (!acquired) {
        lastError = 'another instance is polling the Telegram bot';
        running = false;
        logger.warn(
          'bot: another instance holds the Telegram polling lock - this instance will not start a second poller'
        );
        return { started: false, reason: 'polling_lock_held' };
      }
      startLockRenewal();
    }

    const TelegramBot = require('node-telegram-bot-api');
    client = new TelegramBot(config.token, { polling: config.mode === 'polling' });

    // Transient polling/API failures are retried by the library. Log the message
    // only: a dead token retries every ~500ms and a full stack would flood the log.
    client.on('polling_error', (err) => {
      const message = err?.message || String(err);
      logger.error({ error: message }, 'bot: polling error');
      // Telegram answers 409 when another process is already calling getUpdates
      // for this token. Stop this poller instead of retrying forever.
      if (running && /409/.test(message) && /getUpdates/i.test(message)) {
        logger.warn('bot: 409 polling conflict - stopping this poller');
        stopBot().catch(() => {});
      }
    });
    client.on('error', (err) => logger.error({ error: err?.message }, 'bot: client error'));

    const { register, setupCommandMenus } = require('./commands');
    registered = register(client, config);
    if (!registered) throw new Error('command registration failed');

    if (config.mode === 'webhook') {
      await client.setWebHook(config.webhookUrl);
      logger.info({ mode: 'webhook' }, 'bot: webhook set');
    }

    const me = await client.getMe();
    running = true;
    lastError = null;
    logger.info({ bot: me?.username, mode: config.mode }, 'bot: connected');

    // Register the "/" command menus (group + owner DM). Cosmetic: a failure
    // must not take a working bot down.
    try {
      await setupCommandMenus(client, config);
    } catch (err) {
      logger.warn({ error: err?.message }, 'bot: command menus not set');
    }

    return { started: true, reason: 'ok', mode: config.mode };
  } catch (err) {
    lastError = err?.message || String(err);
    running = false;
    stopLockRenewal();
    // The constructor already began polling, so a failed getMe() (bad token)
    // would otherwise leave a live getUpdates loop retrying forever and flooding
    // the log. Tear it down before giving up.
    try {
      await client?.stopPolling();
    } catch (_) {
      // already stopped
    }
    client = null;
    await releasePollingLock();
    logger.error({ error: lastError }, 'bot: failed to start - HTTP server unaffected');
    return { started: false, reason: 'start_failed', error: lastError };
  }
}

async function stopBot() {
  const hadClient = !!client;
  stopLockRenewal();

  if (client) {
    try {
      if (config?.mode === 'webhook') await client.deleteWebHook();
      await client.stopPolling();
    } catch (err) {
      logger.warn({ err }, 'bot: error during shutdown');
    }
  }

  running = false;
  client = null;
  await releasePollingLock();

  if (!hadClient) return { stopped: false };
  logger.info('bot: stopped');
  return { stopped: true };
}

/**
 * Feed a raw Telegram Update into the bot. Used by BOT_MODE=webhook, where the
 * update arrives over HTTP instead of getUpdates polling.
 * Returns false when the bot is not running, so the route can answer 503.
 */
function processWebhookUpdate(update) {
  if (!client) return false;
  try {
    client.processUpdate(update);
    return true;
  } catch (err) {
    logger.error({ error: err?.message }, 'bot: failed to process webhook update');
    return false;
  }
}

function health() {
  return {
    enabled: !!config?.enabled,
    running,
    mode: config?.mode || null,
    username: config?.botUsername || null,
    allowedGroupCount: config ? config.allowedGroupIds.size + config.allowedGroupUsernames.size : 0,
    lastError,
    configProblems,
  };
}

module.exports = { startBot, stopBot, getClient, getConfig, isRunning, processWebhookUpdate, health };
