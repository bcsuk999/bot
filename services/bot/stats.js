const BotOrder = require('../../models/BotOrder');
const { startOfIstDay, buildBucket, renderBucket, formatInr } = require('./format');

// Group a set of BotOrders by status: count + sum of amount.
function bucketStage() {
  return {
    $group: {
      _id: '$status',
      count: { $sum: 1 },
      amount: { $sum: '$amount' },
    },
  };
}

/**
 * Per-group deposit statistics for one window.
 * Always filtered by `group` so a group can only ever see its own numbers.
 *
 * @param {ObjectId|String} groupId  TelegramGroup _id
 * @param {'today'|'all'} window
 */
async function getGroupStats(groupId, window = 'all') {
  const match = { group: groupId };
  if (window === 'today') {
    match.createdAt = { $gte: startOfIstDay() };
  }

  const rows = await BotOrder.aggregate([{ $match: match }, bucketStage()]);

  const byStatus = {};
  for (const row of rows) {
    byStatus[row._id] = { count: row.count, amount: Number(row.amount?.toString?.() ?? row.amount ?? 0) };
  }
  return buildBucket(byStatus);
}

// Counts for the balance summary: how many orders in each terminal state.
async function getGroupOrderCounts(groupId) {
  const rows = await BotOrder.aggregate([
    { $match: { group: groupId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const out = { success: 0, pending: 0, failed: 0, expired: 0, reversed: 0 };
  for (const row of rows) {
    if (row._id in out) out[row._id] = row.count;
  }
  return out;
}

function renderStatsReport({ groupId, title, today, all, balance, window = 'both' }) {
  const head = `Daily report — ${groupId}${title ? ` (${title})` : ''}`;

  const blocks = [];
  if (window === 'both' || window === 'today') {
    blocks.push(renderBucket('Today (IST)', today));
  }
  if (window === 'both' || window === 'all') {
    if (blocks.length) blocks.push('');
    blocks.push(renderBucket('All time', all));
  }

  blocks.push('');
  blocks.push(`Current balance: ${formatInr(balance)}`);

  return [head, '', ...blocks].join('\n');
}

module.exports = { getGroupStats, getGroupOrderCounts, renderStatsReport };
