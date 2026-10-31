// Pure query helpers for the admin REST API. No I/O, so they are unit-testable.
//
// Conventions used by every list endpoint:
//   ?page=1&limit=20
//   ?from=2026-10-01&to=2026-10-31        (inclusive, ISO date or timestamp)
//   ?groupId=-1001234567890              (partial, case-insensitive)
//   ?orderId=B2026...                    (partial, case-insensitive for transactions)

const GROUP_STATUSES = ['active', 'banned', 'suspended'];
const ORDER_STATUSES = ['pending', 'success', 'failed', 'expired', 'reversed'];
const TRANSACTION_TYPES = ['credit', 'debit'];
const TRANSACTION_NOTES = ['deposit', 'adjustment', 'reversal'];
const TRANSACTION_STATUSES = ['success', 'reversed'];

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contains(value) {
  return { $regex: escapeRegex(String(value).trim()), $options: 'i' };
}

function parseDate(value, field) {
  if (value == null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(`${field} must be a valid date`);
  }
  return date;
}

function buildDateRange({ from, to } = {}) {
  const range = {};
  const start = parseDate(from, 'from');
  const end = parseDate(to, 'to');
  if (start && end && start > end) {
    throw httpError('from must be before or equal to to');
  }
  if (start) range.$gte = start;
  if (end) {
    // A date-only `to=2026-10-31` means the whole day, not 00:00.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) {
      end.setUTCHours(23, 59, 59, 999);
    }
    range.$lte = end;
  }
  return Object.keys(range).length ? range : null;
}

function pick(value) {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function buildGroupFilter(query = {}) {
  const filter = {};
  const groupId = pick(query.groupId);
  const title = pick(query.title);
  const status = pick(query.status);

  if (groupId) filter.groupId = contains(groupId);
  if (title) filter.title = contains(title);
  if (status) {
    if (!GROUP_STATUSES.includes(status)) {
      throw httpError(`status must be one of: ${GROUP_STATUSES.join(', ')}`);
    }
    filter.status = status;
  }

  const range = buildDateRange(query);
  if (range) filter.createdAt = range;
  return filter;
}

function buildOrderFilter(query = {}) {
  const filter = {};
  const orderId = pick(query.orderId);
  const groupId = pick(query.groupId);
  const status = pick(query.status);

  if (orderId) filter.orderId = contains(orderId);
  if (groupId) filter.groupId = contains(groupId);
  if (status) {
    if (!ORDER_STATUSES.includes(status)) {
      throw httpError(`status must be one of: ${ORDER_STATUSES.join(', ')}`);
    }
    filter.status = status;
  }

  const range = buildDateRange(query);
  if (range) filter.createdAt = range;
  return filter;
}

function buildTransactionFilter(query = {}) {
  const filter = {};
  const trnId = pick(query.trnId);
  const orderId = pick(query.orderId);
  const groupId = pick(query.groupId);
  const type = pick(query.type);
  const note = pick(query.note);
  const status = pick(query.status);

  if (trnId) filter.trnId = contains(trnId);
  if (orderId) filter.orderId = contains(orderId);
  if (groupId) filter.groupId = contains(groupId);
  if (type) {
    if (!TRANSACTION_TYPES.includes(type)) {
      throw httpError(`type must be one of: ${TRANSACTION_TYPES.join(', ')}`);
    }
    filter.type = type;
  }
  if (note) {
    if (!TRANSACTION_NOTES.includes(note)) {
      throw httpError(`note must be one of: ${TRANSACTION_NOTES.join(', ')}`);
    }
    filter.note = note;
  }
  if (status) {
    if (!TRANSACTION_STATUSES.includes(status)) {
      throw httpError(`status must be one of: ${TRANSACTION_STATUSES.join(', ')}`);
    }
    filter.status = status;
  }

  const range = buildDateRange(query);
  if (range) filter.createdAt = range;
  return filter;
}

// Echo only the filters the caller actually supplied, so the response documents
// exactly which subset was applied.
function echoFilters(query = {}, keys = []) {
  const out = {};
  for (const key of keys) {
    const value = pick(query[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function buildMeta({ total, page, limit }) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

module.exports = {
  GROUP_STATUSES,
  ORDER_STATUSES,
  TRANSACTION_TYPES,
  TRANSACTION_NOTES,
  TRANSACTION_STATUSES,
  escapeRegex,
  parseDate,
  buildDateRange,
  buildGroupFilter,
  buildOrderFilter,
  buildTransactionFilter,
  echoFilters,
  buildMeta,
};
