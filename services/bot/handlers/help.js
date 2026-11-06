// Command list shown inside the bot. /reg is deliberately absent from the group
// version: only the owner's private chat advertises it. See setupCommandMenus()
// in services/bot/commands.js for the Telegram "/" menu.

const GROUP_LINES = [
  '/balance - Check this group balance',
  '/deposit <amount> - Create a deposit',
  '/how     - How to create a deposit and use the bot',
  '/status <order id> - Check a deposit status',
  '/daily   - Deposit success rate (10m / 30m / 1h / today)',
];

const REG_LINE = '/reg     - Register a group (run it inside the group)';
const INFO_LINE = '/info <message> - Notify all active registered groups';

function helpText({ isOwner = false } = {}) {
  const lines = ['Commands:'];
  if (isOwner) lines.push(REG_LINE, INFO_LINE);
  lines.push(...GROUP_LINES);
  return lines.join('\n');
}

const HELP = helpText();

module.exports = { HELP, helpText, REG_LINE, INFO_LINE, GROUP_LINES };
