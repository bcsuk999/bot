const logger = require('../../utils/logger');
const { loadConfig, validateConfig } = require('./config');

let client = null;
let config = null;
let running = false;
let registered = false;
let lastError = null;
let configProblems = null;

function getClient() {
  return client;
}

function getConfig() {
  return config;
}

function isRunning() {
  return running;
}

/**
 * Start the Telegram bot. Never throws: a bot failure must not take the HTTP
 * server down with it.
 */
async function startBot() {
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
    const TelegramBot = require('node-telegram-bot-api');
    client = new TelegramBot(config.token, { polling: config.mode === 'polling' });

    // Transient polling/API failures are retried by the library. Log the message
    // only: a dead token retries every ~500ms and a full stack would flood the log.
    client.on('polling_error', (err) => logger.error({ msg: err?.message }, 'bot: polling error'));
    client.on('error', (err) => logger.error({ msg: err?.message }, 'bot: client error'));

    const { register } = require('./commands');
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
    return { started: true, reason: 'ok', mode: config.mode };
  } catch (err) {
    lastError = err?.message || String(err);
    running = false;
    // The constructor already began polling, so a failed getMe() (bad token)
    // would otherwise leave a live getUpdates loop retrying forever and flooding
    // the log. Tear it down before giving up.
    try {
      await client?.stopPolling();
    } catch (_) {
      // already stopped
    }
    client = null;
    logger.error({ msg: lastError }, 'bot: failed to start - HTTP server unaffected');
    return { started: false, reason: 'start_failed', error: lastError };
  }
}

async function stopBot() {
  if (!client) return { stopped: false };
  try {
    if (config?.mode === 'webhook') await client.deleteWebHook();
    await client.stopPolling();
  } catch (err) {
    logger.warn({ err }, 'bot: error during shutdown');
  }
  running = false;
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
    logger.error({ msg: err?.message }, 'bot: failed to process webhook update');
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
