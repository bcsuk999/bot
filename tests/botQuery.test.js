import { describe, it, expect } from 'vitest';
import {
  buildGroupFilter,
  buildOrderFilter,
  buildTransactionFilter,
  buildMeta,
  echoFilters,
  escapeRegex,
  encodeCursor,
  parseCursor,
  buildCursorFilter,
  applyCursor,
} from '../services/bot/query.js';

describe('escapeRegex', () => {
  it('escapes user input so it is matched literally', () => {
    expect(escapeRegex('a.b*c?')).toBe('a\\.b\\*c\\?');
    expect(escapeRegex('-1001234567890')).toBe('-1001234567890');
  });
});

describe('buildGroupFilter', () => {
  it('returns an empty filter when nothing is supplied', () => {
    expect(buildGroupFilter({})).toEqual({});
  });

  it('matches groupId and title partially, case-insensitively', () => {
    expect(buildGroupFilter({ groupId: ' -100 ', title: 'Sub' })).toEqual({
      groupId: { $regex: '-100', $options: 'i' },
      title: { $regex: 'Sub', $options: 'i' },
    });
  });

  it('accepts active, banned and suspended only', () => {
    expect(buildGroupFilter({ status: 'suspended' })).toEqual({ status: 'suspended' });
    expect(() => buildGroupFilter({ status: 'deleted' })).toThrow(/status must be one of/);
  });

  it('builds an inclusive createdAt range (date-only `to` covers the whole day)', () => {
    const filter = buildGroupFilter({ from: '2026-10-01', to: '2026-10-31' });
    expect(filter.createdAt.$gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(filter.createdAt.$lte.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });

  it('rejects an invalid date and a reversed range', () => {
    expect(() => buildGroupFilter({ from: 'nope' })).toThrow(/from must be a valid date/);
    expect(() => buildGroupFilter({ from: '2026-10-31', to: '2026-10-01' })).toThrow(/from must be before/);
  });
});

describe('buildOrderFilter', () => {
  it('filters by orderId, groupId and status', () => {
    expect(buildOrderFilter({ orderId: 'B2026', groupId: '-100', status: 'success' })).toEqual({
      orderId: { $regex: 'B2026', $options: 'i' },
      groupId: { $regex: '-100', $options: 'i' },
      status: 'success',
    });
  });

  it('rejects an unknown order status', () => {
    expect(() => buildOrderFilter({ status: 'cancelled' })).toThrow(/status must be one of/);
  });
});

describe('buildTransactionFilter', () => {
  it('filters by trnId, orderId, groupId, type, note and status', () => {
    expect(
      buildTransactionFilter({
        trnId: 'BTXN1',
        orderId: 'B2026',
        groupId: '-100',
        type: 'credit',
        note: 'deposit',
        status: 'success',
      })
    ).toEqual({
      trnId: { $regex: 'BTXN1', $options: 'i' },
      orderId: { $regex: 'B2026', $options: 'i' },
      groupId: { $regex: '-100', $options: 'i' },
      type: 'credit',
      note: 'deposit',
      status: 'success',
    });
  });

  it('rejects unknown type, note and status values', () => {
    expect(() => buildTransactionFilter({ type: 'transfer' })).toThrow(/type must be one of/);
    expect(() => buildTransactionFilter({ note: 'bonus' })).toThrow(/note must be one of/);
    expect(() => buildTransactionFilter({ status: 'pending' })).toThrow(/status must be one of/);
  });

  it('applies the date range to createdAt', () => {
    const filter = buildTransactionFilter({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T23:59:59Z' });
    expect(filter.createdAt.$gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(filter.createdAt.$lte.toISOString()).toBe('2026-10-01T23:59:59.000Z');
  });
});

describe('buildMeta', () => {
  it('reports page state for a middle page', () => {
    expect(buildMeta({ total: 95, page: 2, limit: 20 })).toEqual({
      total: 95,
      page: 2,
      limit: 20,
      totalPages: 5,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('handles the last page and an empty result', () => {
    expect(buildMeta({ total: 40, page: 2, limit: 20 })).toMatchObject({
      totalPages: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
    expect(buildMeta({ total: 0, page: 1, limit: 20 })).toMatchObject({
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });
});

describe('echoFilters', () => {
  it('keeps only supplied, non-empty filters', () => {
    expect(
      echoFilters({ groupId: ' -100 ', status: '', from: '2026-10-01', page: 3 }, [
        'groupId',
        'status',
        'from',
        'to',
      ])
    ).toEqual({ groupId: '-100', from: '2026-10-01' });
  });
});

describe('keyset cursor', () => {
  const row = {
    _id: '6512f0c2a4b1c2d3e4f5a6b7',
    createdAt: new Date('2026-10-31T09:12:00.123Z'),
  };

  it('round-trips a row through encode/parse', () => {
    const cursor = encodeCursor(row);
    expect(typeof cursor).toBe('string');
    const parsed = parseCursor(cursor);
    expect(parsed.createdAt.toISOString()).toBe(row.createdAt.toISOString());
    expect(parsed.id).toBe(row._id);
  });

  it('treats a missing or blank cursor as no cursor', () => {
    expect(encodeCursor(null)).toBeNull();
    expect(parseCursor(undefined)).toBeNull();
    expect(parseCursor('')).toBeNull();
    expect(parseCursor('   ')).toBeNull();
  });

  it('rejects a malformed cursor', () => {
    for (const value of ['not-a-cursor', Buffer.from('abc').toString('base64url'), Buffer.from('|id').toString('base64url')]) {
      expect(() => parseCursor(value)).toThrow(/cursor is invalid/);
    }
  });

  it('picks rows strictly older than the cursor row, with an _id tie-break', () => {
    const filter = buildCursorFilter(parseCursor(encodeCursor(row)));
    expect(filter.$or).toEqual([
      { createdAt: { $lt: row.createdAt } },
      { createdAt: row.createdAt, _id: { $lt: row._id } },
    ]);
  });

  it('ANDs with existing filters and the resolved group scope', () => {
    const filter = { status: 'success', $or: [{ group: 'g1' }] };
    applyCursor(filter, { createdAt: row.createdAt, id: row._id });

    expect(filter.status).toBe('success');
    expect(filter.$or).toEqual([{ group: 'g1' }]);
    expect(filter.$and).toHaveLength(1);
    expect(filter.$and[0].$or).toHaveLength(2);
  });

  it('leaves a filter untouched without a cursor', () => {
    const filter = { status: 'success' };
    applyCursor(filter, null);
    expect(filter).toEqual({ status: 'success' });
  });
});
