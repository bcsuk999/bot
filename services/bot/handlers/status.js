const BotOrder = require('../../../models/BotOrder');
const { formatInr, formatIst, escapeHtml } = require('../format');
const logger = require('../../../utils/logger');

/**
 * Render one order as a payment slip. `Success on` is only meaningful for a
 * credited order, so it is appended only for status `success`.
 *
 * @returns {{ text: string, options: object }}
 */
function buildStatusReply(order) {
  if (!order) {
    return { text: 'Order not found in this group.' };
  }

  const lines = [
    `Order ID: <code>${escapeHtml(order.orderId)}</code>`,
    `Amount: ${formatInr(order.amount)}`,
    `Status: ${order.status}`,
    `Created on: ${formatIst(order.createdAt)}`,
  ];

  if (order.status === 'success') {
    lines.push(`Success on: ${formatIst(order.paidAt || order.updatedAt)}`);
  }

  return { text: lines.join('\n'), options: { parse_mode: 'HTML' } };
}

// /status <order id> - scoped to the group that runs it. An order id from
// another group is indistinguishable from a non-existent one on purpose.
async function cmdStatus(ctx) {
  const { group, args } = ctx;

  const orderId = String(args[0] || '').trim();
  if (!orderId) {
    return { text: 'Usage: /status <order id>\nExample: /status B20260928093925967924200' };
  }

  const order = await BotOrder.findOne({ orderId, groupId: group.groupId });
  logger.info({ groupId: group.groupId, orderId, found: !!order }, 'bot: /status');

  return buildStatusReply(order);
}

module.exports = { cmdStatus, buildStatusReply };
