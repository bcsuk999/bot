// Pure query helpers for the admin REST API. No I/O, so they are unit-testable.
//
// Conventions used by every list endpoint:
//   ?page=1&limit=20
//   ?from=2026-10-01&to=2026-10-31        (inclusive, ISO date or timestamp)
//   ?groupId=-1001234567890              (partial, case-insensitive)
//   ?orderId=B2026...                    (partial, case-insensitive for transactions)

const { isValidUid } = require('./uid');

const GROUP_STATUSES = ['active', 'banned', 'suspended'];
const ORDER_STATUSES = ['pending', 'success', 'failed', 'expired', 'reversed'];
const ORDER_DIRECTIONS = ['credit', 'debit'];
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

/** uid is an exact 5-digit code, so a malformed one is a client error, not "no match". */
function pickUid(value) {
  const uid = pick(value);
  if (uid === undefined) return undefined;
  if (!isValidUid(uid)) {
    throw httpError('uid must be a 5 digit number');
  }
  return uid;
}

function buildGroupFilter(query = {}) {
  const filter = {};
  const groupId = pick(query.groupId);
  const title = pick(query.title);
  const status = pick(query.status);
  const uid = pickUid(query.uid);

  if (groupId) filter.groupId = contains(groupId);
  if (title) filter.title = contains(title);
  if (uid) filter.uid = uid;
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
  const direction = pick(query.direction);

  if (orderId) filter.orderId = contains(orderId);
  if (groupId) filter.groupId = contains(groupId);
  if (status) {
    if (!ORDER_STATUSES.includes(status)) {
      throw httpError(`status must be one of: ${ORDER_STATUSES.join(', ')}`);
    }
    filter.status = status;
  }
  // Filter by direction: 'credit' for deposits, 'debit' for withdrawals/adjustments
  if (direction) {
    if (!ORDER_DIRECTIONS.includes(direction)) {
      throw httpError(`direction must be one of: ${ORDER_DIRECTIONS.join(', ')}`);
    }
    filter.direction = direction;
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

/**
 * Replace a textual `groupId` filter with an exact group scope. Matching on the
 * ObjectId or the stored Telegram id keeps rows written before either field
 * existed while staying indexable (no unanchored regex).
 */
function applyGroupScope(filter, group) {
  if (!group) return filter;
  delete filter.groupId;
  filter.$or = [{ group: group._id }, { groupId: group.groupId }];
  return filter;
}

/**
 * Keyset cursor for `createdAt: -1` lists. A cursor is opaque to clients:
 * base64url of `<epoch millis>|<_id>`. Keyset paging avoids the O(skip) walk
 * that makes deep `?page=500` requests slow, while `meta.total` stays accurate.
 */
function encodeCursor(doc) {
  if (!doc || !doc.createdAt) return null;
  const time = new Date(doc.createdAt).getTime();
  if (Number.isNaN(time)) return null;
  const id = doc._id == null ? '' : String(doc._id);
  return Buffer.from(`${time}|${id}`, 'utf8').toString('base64url');
}

function parseCursor(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = Buffer.from(String(value).trim(), 'base64url').toString('utf8');
  const separator = raw.indexOf('|');
  const time = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (separator < 1 || !Number.isFinite(time) || !id) {
    throw httpError('cursor is invalid');
  }
  return { createdAt: new Date(time), id };
}

/** Strictly "older than this row" for a `createdAt DESC, _id DESC` sort. */
function buildCursorFilter(cursor) {
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}

/** AND the cursor clause with whatever filters were already built. */
function applyCursor(filter, cursor) {
  if (!cursor) return filter;
  filter.$and = [...(filter.$and || []), buildCursorFilter(cursor)];
  return filter;
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
  pickUid,
  buildGroupFilter,
  buildOrderFilter,
  buildTransactionFilter,
  echoFilters,
  buildMeta,
  applyGroupScope,
  encodeCursor,
  parseCursor,
  buildCursorFilter,
  applyCursor,
};
