const { parsePlArgs, getGroupPnlRows, renderPnlReport, chunkText } = require('../pnl');
const logger = require('../../../utils/logger');

/**
 * /pl <DD/MM/YY> <cost per USDT>
 *
 * Owner-only report: one block per active group with that day's deposits,
 * lifetime deposits/payouts and the group's profit/loss. Returns Telegram-sized
 * chunks so a long report can be sent as several messages.
 */
async function cmdPl(ctx) {
  const parsed = parsePlArgs(ctx.args || []);
  if (!parsed.ok) return { text: parsed.text };

  const rows = await getGroupPnlRows({ start: parsed.start, end: parsed.end });
  const text = renderPnlReport({
    dateLabel: parsed.label,
    cost: parsed.cost,
    rows,
  });

  logger.info(
    { date: parsed.label, cost: parsed.cost, groups: rows.length },
    'bot: /pl report generated'
  );

  return { chunks: chunkText(text) };
}

module.exports = { cmdPl };
