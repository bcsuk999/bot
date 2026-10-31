// Pure formatting helpers for Telegram messages. No I/O - unit-testable.

const IST_OFFSET_MIN = 330;

/**
 * Midnight IST (as a UTC Date) for the day containing `now`.
 * Timezone-safe on any host: shift into IST, truncate with Date.UTC, shift back.
 */
function startOfIstDay(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60 * 1000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIst - IST_OFFSET_MIN * 60 * 1000);
}

function formatIst(date = new Date()) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// 12500 -> "12,500.00"
function formatAmount(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 12500 -> "₹12,500.00"
function formatInr(value) {
  return `₹${formatAmount(value)}`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Owner alerts interpolate user-supplied titles/usernames into parse_mode HTML.
function escapeHtmlAll(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function label(value, width = 14) {
  return String(value).padEnd(width, ' ');
}

function emptyBucket() {
  return {
    totalOrders: 0,
    totalAmount: 0,
    success: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    failed: { count: 0, amount: 0 },
    expired: { count: 0, amount: 0 },
    reversed: { count: 0, amount: 0 },
  };
}

// Fold a status-keyed aggregation result into a full bucket (all statuses present).
function buildBucket(byStatus = {}) {
  const bucket = emptyBucket();
  for (const [status, row] of Object.entries(byStatus || {})) {
    const count = Number(row?.count) || 0;
    const amount = Number(row?.amount) || 0;
    bucket.totalOrders += count;
    bucket.totalAmount += amount;
    if (bucket[status]) {
      bucket[status].count = count;
      bucket[status].amount = amount;
    }
  }
  return bucket;
}

function renderBucket(title, bucket) {
  return [
    title,
    `Total orders: ${bucket.totalOrders}`,
    `Total amount: ${formatInr(bucket.totalAmount)}`,
    `Success: ${bucket.success.count} (${formatInr(bucket.success.amount)})`,
    `Pending: ${bucket.pending.count} (${formatInr(bucket.pending.amount)})`,
    `Failed: ${bucket.failed.count} (${formatInr(bucket.failed.amount)})`,
    `Expired: ${bucket.expired.count} (${formatInr(bucket.expired.amount)})`,
    `Reversed: ${bucket.reversed.count} (${formatInr(bucket.reversed.amount)})`,
  ].join('\n');
}

module.exports = {
  IST_OFFSET_MIN,
  startOfIstDay,
  formatIst,
  formatAmount,
  formatInr,
  escapeHtml,
  escapeHtmlAll,
  label,
  emptyBucket,
  buildBucket,
  renderBucket,
};
