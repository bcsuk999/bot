// Group profit/loss report behind /pl.
//
// One report covers every active group for a single IST day:
//   /pl 23/11/26 107      (day, cost we pay per 1 USDT in INR)
//
// P&L per group = (((rate - cost) / rate) - 0.056) * that day's deposit
// where `rate` is the admin-set group exchange rate (INR per 1 USDT) and
// 0.056 is the 5.6% payment gateway charge.

const BotOrder = require('../../models/BotOrder');
const TelegramGroup = require('../../models/TelegramGroup');
const { IST_OFFSET_MIN, formatInr } = require('./format');

const GATEWAY_FEE_RATE = 0.056;
// Telegram hard-caps a message at 4096 chars. Keep a little headroom.
const TELEGRAM_MESSAGE_LIMIT = 4096;
const CHUNK_LIMIT = 4000;

function toNumber(value) {
  if (value == null) return 0;
  const n = typeof value === 'object' && value.toString ? parseFloat(value.toString()) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Parse `DD/MM/YY` (or `DD/MM/YYYY`) into the IST day it names.
 * Returns null for anything that is not a real calendar date.
 */
function parseIstDate(input) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(input ?? '').trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);

  const utcMidnight = Date.UTC(year, month - 1, day);
  const check = new Date(utcMidnight);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  const start = new Date(utcMidnight - IST_OFFSET_MIN * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    label: `${pad2(day)}/${pad2(month)}/${year}`,
  };
}

/**
 * Validate the two /pl arguments.
 * @returns {{ok:true,start:Date,end:Date,label:string,cost:number}|{ok:false,text:string}}
 */
function parsePlArgs(args = []) {
  const [dateArg, costArg] = args;
  if (!dateArg || costArg == null) {
    return { ok: false, text: 'Usage: /pl <DD/MM/YY> <cost per USDT>' };
  }

  const day = parseIstDate(dateArg);
  if (!day) {
    return { ok: false, text: 'Invalid date. Use DD/MM/YY, e.g. /pl 23/11/26 107' };
  }

  const cost = Number(costArg);
  if (!Number.isFinite(cost) || cost <= 0) {
    return { ok: false, text: 'Invalid cost. Use a positive number, e.g. 107' };
  }

  return { ok: true, ...day, cost };
}

/**
 * Profit/loss for one group. Returns null when the group has no rate, so the
 * report can say "rate not set" instead of showing a misleading number.
 */
function computePnl({ exchangeRate, cost, deposit }) {
  const rate = Number(exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const margin = (rate - Number(cost)) / rate - GATEWAY_FEE_RATE;
  const depositValue = Number(deposit) || 0;
  return Math.round(margin * depositValue * 100) / 100;
}

function formatSignedInr(value) {
  const n = Number(value) || 0;
  return n < 0 ? `-${formatInr(Math.abs(n))}` : `+${formatInr(n)}`;
}

// 🟢 for profit (or break-even), 🔴 for a loss.
function formatPnlWithEmoji(value) {
  const n = Number(value) || 0;
  const icon = n < 0 ? '🔴' : '🟢';
  const amount = formatInr(Math.abs(n));
  return n < 0 ? `${icon}-${amount}` : `${icon}${amount}`;
}

function formatRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(n) : '-';
}

/**
 * Aggregate every active group's deposits and payouts for the window.
 *
 * - deposit: BotOrder status success, direction != 'debit'
 * - payout:  BotOrder status success, direction == 'debit' (manual adjustment)
 * Totals are lifetime; "today" figures are limited to [start, end).
 */
async function getGroupPnlRows({ start, end }) {
  const [rows, groups] = await Promise.all([
    BotOrder.aggregate([
      { $match: { status: 'success' } },
      {
        $group: {
          _id: '$group',
          totalDeposit: {
            $sum: { $cond: [{ $ne: ['$direction', 'debit'] }, '$amount', 0] },
          },
          todayDeposit: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$direction', 'debit'] },
                    { $gte: ['$createdAt', start] },
                    { $lt: ['$createdAt', end] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
          totalPayout: {
            $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] },
          },
          todayPayout: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$direction', 'debit'] },
                    { $gte: ['$createdAt', start] },
                    { $lt: ['$createdAt', end] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
        },
      },
    ]),
    TelegramGroup.find({
      status: 'active',
      // Groups with no rate are excluded from /pl entirely.
      exchangeRate: { $ne: null, $gt: 0 },
    })
      .select('groupId uid title exchangeRate createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean({ getters: true }),
  ]);

  const byGroup = new Map(rows.map((row) => [String(row._id), row]));

  return groups.map((group) => {
    const agg = byGroup.get(String(group._id)) || {};
    return {
      groupId: group.groupId,
      uid: group.uid || null,
      title: group.title || '',
      exchangeRate: group.exchangeRate == null ? null : toNumber(group.exchangeRate),
      todayDeposit: toNumber(agg.todayDeposit),
      totalDeposit: toNumber(agg.totalDeposit),
      todayPayout: toNumber(agg.todayPayout),
      totalPayout: toNumber(agg.totalPayout),
    };
  });
}

function renderPnlBlock(row, cost) {
  const pnl = computePnl({
    exchangeRate: row.exchangeRate,
    cost,
    deposit: row.todayDeposit,
  });

  const pnlText = pnl == null ? 'rate not set' : formatPnlWithEmoji(pnl);
  const lines = [
    `UID ${row.uid || '-'} | ${formatRate(row.exchangeRate)} | P/L ${pnlText}`,
    `Today ${formatInr(row.todayDeposit)} | Total ${formatInr(row.totalDeposit)}`,
    `Payout ${formatInr(row.totalPayout)} | Today payout ${formatInr(row.todayPayout)}`,
  ];

  return lines.join('\n');
}

// Totals across groups that have an exchange rate set. Groups without a rate
// are excluded from every figure, per the report's business rule.
function summarizeRatedRows(rows = [], cost) {
  const totals = {
    groups: 0,
    todayDeposit: 0,
    totalDeposit: 0,
    totalPayout: 0,
    todayPayout: 0,
    pnl: 0,
  };

  for (const row of rows) {
    const pnl = computePnl({
      exchangeRate: row.exchangeRate,
      cost,
      deposit: row.todayDeposit,
    });
    if (pnl == null) continue;

    totals.groups += 1;
    totals.todayDeposit += Number(row.todayDeposit) || 0;
    totals.totalDeposit += Number(row.totalDeposit) || 0;
    totals.totalPayout += Number(row.totalPayout) || 0;
    totals.todayPayout += Number(row.todayPayout) || 0;
    totals.pnl += pnl;
  }

  totals.pnl = Math.round(totals.pnl * 100) / 100;
  return totals;
}

function renderPnlSummary(totals) {
  return [
    `All groups total | P/L ${formatPnlWithEmoji(totals.pnl)}`,
    `Today ${formatInr(totals.todayDeposit)} | Total ${formatInr(totals.totalDeposit)}`,
    `Payout ${formatInr(totals.totalPayout)} | Today payout ${formatInr(totals.todayPayout)}`,
  ].join('\n');
}

function hasExchangeRate(row) {
  const rate = Number(row?.exchangeRate);
  return Number.isFinite(rate) && rate > 0;
}

function renderPnlReport({ rows = [], cost }) {
  const rated = rows.filter(hasExchangeRate);
  if (!rated.length) return 'No active groups with an exchange rate set.';

  const blocks = rated.map((row) => renderPnlBlock(row, cost));
  blocks.push(renderPnlSummary(summarizeRatedRows(rated, cost)));

  return blocks.join('\n\n');
}

/**
 * Split a report into Telegram-sized chunks. Prefers block boundaries, and
 * hard-splits a single oversized block so no chunk ever exceeds the limit.
 */
function chunkText(text, limit = CHUNK_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= limit) return [value];

  const chunks = [];
  let current = '';

  for (const block of value.split('\n\n')) {
    const next = current ? `${current}\n\n${block}` : block;

    if (next.length <= limit) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);

    if (block.length > limit) {
      for (let i = 0; i < block.length; i += limit) {
        chunks.push(block.slice(i, i + limit));
      }
      current = '';
    } else {
      current = block;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  GATEWAY_FEE_RATE,
  TELEGRAM_MESSAGE_LIMIT,
  CHUNK_LIMIT,
  parseIstDate,
  parsePlArgs,
  computePnl,
  getGroupPnlRows,
  renderPnlBlock,
  renderPnlReport,
  summarizeRatedRows,
  renderPnlSummary,
  hasExchangeRate,
  chunkText,
  formatSignedInr,
  formatPnlWithEmoji,
  formatRate,
};
