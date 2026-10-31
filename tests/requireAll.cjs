/**
 * Loads every bot module through Node's own CommonJS resolver.
 *
 * This exists because vitest resolves imports with Vite, which is more forgiving
 * than Node. A wrong relative path in a handler (`../../../utils/logger` from the
 * wrong directory) passed the whole vitest suite and then crashed at runtime with
 * "Cannot find module". Run with plain `node`, so a bad path fails here instead of
 * in production.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const MODULES = [
  'services/bot/config',
  'services/bot/format',
  'services/bot/upilink',
  'services/bot/stats',
  'services/bot/guard',
  'services/bot/client',
  'services/bot/commands',
  'services/bot/handlers/help',
  'services/bot/handlers/reg',
  'services/bot/handlers/balance',
  'services/bot/handlers/deposit',
  'services/bot/handlers/daily',
  'services/bot/handlers/status',
  'services/bot/handlers/start',
  'services/botGroupService',
  'services/simplypay',
  'models/TelegramGroup',
  'models/BotOrder',
  'models/BotTransaction',
  'controllers/botController',
  'controllers/botWebhookController',
  'routes/bot',
];

const failures = [];

for (const mod of MODULES) {
  try {
    require(path.join(ROOT, mod));
  } catch (err) {
    failures.push({ mod, message: (err && err.message ? err.message : String(err)).split('\n')[0] });
  }
}

if (failures.length) {
  console.error(`\nModule load check FAILED (${failures.length}/${MODULES.length}):\n`);
  for (const f of failures) console.error(`  ${f.mod}\n    -> ${f.message}\n`);
  process.exit(1);
}

console.log(`Module load check passed: ${MODULES.length}/${MODULES.length} modules resolve under Node CJS.`);
