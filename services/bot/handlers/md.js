/**
 * The /md (maintenance) reply: when maintenance mode is active,
 * groups cannot use any commands - they just receive a static message.
 * Only the bot owner can toggle maintenance mode.
 *
 * Usage in botController or command dispatcher:
 *   if (maintenanceMode) return reply(maintenanceReply());
 *
 * The maintenance flag is typically stored in config or a model,
 * and toggled via an admin endpoint (e.g. POST /api/admin/maintenance).
 */

// Maintenance message - owner should customize as needed
const MAINTENANCE_MESSAGE = `🩷🩷
Please pay attention: if any UPI have reached the daily limit or are unable to send payment, let us know in the group so we can take appropriate action. Thank you. Happy earning.
Performance: Consistent success rate`;

// Default: maintenance off. Set to true to enable.
let maintenanceMode = false;

/**
 * Set maintenance mode on/off (owner only)
 * @param {boolean} enabled
 */
function setMaintenanceMode(enabled) {
  maintenanceMode = enabled;
}

/**
 * Get current maintenance mode status
 * @returns {boolean}
 */
function getMaintenanceMode() {
  return maintenanceMode;
}

/**
 * Reply when maintenance mode is active.
 * Groups receive this message and cannot execute commands.
 * @param {object} ctx - context object with chat, from, client, config
 * @param {object} client - telegram bot client
 * @param {object} config - bot configuration
 * @returns {Promise<object>} - reply object with text and options
 */
async function maintenanceReply({ ctx, client, config }) {
  const { chat, from } = ctx;

  // Owner sees the toggle info in DMs if needed, but groups just get the message
  const text = MAINTENANCE_MESSAGE;

  const options = {
    parse_mode: 'HTML',
  };

  return { text, options };
}

module.exports = {
  setMaintenanceMode,
  getMaintenanceMode,
  maintenanceReply,
  MAINTENANCE_MESSAGE,
};