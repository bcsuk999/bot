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
 * Orders in [since, now] for one group, folded into a full status bucket.
 * `since` omitted/undefined means all time.
 * Always filtered by `group` so a group can only ever see its own numbers.
 *
 * @param {ObjectId|String} groupId  TelegramGroup _id
 * @param {Date|null} [since]
 */
async function getGroupStatsSince(groupId, since) {
  const match = { group: groupId };
  if (since) match.createdAt = { $gte: since };

  const rows = await BotOrder.aggregate([{ $match: match }, bucketStage()]);

  const byStatus = {};
  for (const row of rows) {
    byStatus[row._id] = { count: row.count, amount: Number(row.amount?.toString?.() ?? row.amount ?? 0) };
  }
  return buildBucket(byStatus);
}

/**
 * Per-group deposit statistics for one window.
 *
 * @param {ObjectId|String} groupId  TelegramGroup _id
 * @param {'today'|'all'} window
 */
async function getGroupStats(groupId, window = 'all') {
  return getGroupStatsSince(groupId, window === 'today' ? startOfIstDay() : null);
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

// One /daily rate line: `label: succeeded/total=rate% ₹succeeded amount`.
// An empty window is 0/0=0.00%, never NaN.
function renderRateLine(label, bucket) {
  const total = bucket?.totalOrders || 0;
  const succeeded = bucket?.success?.count || 0;
  const rate = total > 0 ? (succeeded / total) * 100 : 0;
  return `${label}: ${succeeded}/${total}=${rate.toFixed(2)}% ${formatInr(bucket?.success?.amount || 0)}`;
}

// The /daily reply: one success-rate line per window, newest window first.
function renderRateReport(windows = []) {
  return windows.map(({ label, bucket }) => `😭 ${renderRateLine(label, bucket)}`).join('\n');
}

// Detailed per-status block report. /daily now renders the rate lines above
// instead; this stays exported because it is the only full breakdown available.
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

module.exports = {
  getGroupStats,
  getGroupStatsSince,
  getGroupOrderCounts,
  renderRateLine,
  renderRateReport,
  renderStatsReport,
};
