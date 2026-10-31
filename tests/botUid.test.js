import { describe, it, expect } from 'vitest';
import { isValidUid, randomUid, UID_MIN, UID_MAX } from '../services/bot/uid.js';
import { buildGroupFilter, buildTransactionFilter, pickUid, applyGroupScope } from '../services/bot/query.js';

describe('uid helpers', () => {
  it('accepts exactly five digits, as a string or a number', () => {
    expect(isValidUid('32045')).toBe(true);
    expect(isValidUid(32045)).toBe(true);
    expect(isValidUid(' 32045 ')).toBe(true);
  });

  it('rejects anything that is not five digits', () => {
    for (const value of ['3204', '320456', 'abcde', '32O45', '320-45', '', null, undefined, 32045.5]) {
      expect(isValidUid(value)).toBe(false);
    }
  });

  it('generates a code inside the five-digit range', () => {
    expect(randomUid(() => 0)).toBe('10000');
    expect(randomUid(() => 0.999999)).toBe('99999');
    expect(randomUid()).toMatch(/^\d{5}$/);
  });

  it('stays within the documented bounds', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = Number(randomUid());
      expect(value).toBeGreaterThanOrEqual(UID_MIN);
      expect(value).toBeLessThanOrEqual(UID_MAX);
    }
  });
});

describe('uid filters', () => {
  it('filters groups by the exact uid', () => {
    expect(buildGroupFilter({ uid: '32045' })).toEqual({ uid: '32045' });
    expect(buildGroupFilter({ uid: ' 32045 ' })).toEqual({ uid: '32045' });
  });

  it('combines uid with the other group filters', () => {
    expect(buildGroupFilter({ uid: '32045', status: 'active' })).toEqual({ uid: '32045', status: 'active' });
  });

  it('rejects a malformed uid instead of returning an empty list', () => {
    expect(() => buildGroupFilter({ uid: '3204' })).toThrow(/uid must be a 5 digit number/);
    expect(() => pickUid('123456')).toThrow(/uid must be a 5 digit number/);
    expect(() => pickUid('abcde')).toThrow(/uid must be a 5 digit number/);
  });

  it('treats a blank uid as not supplied', () => {
    expect(pickUid('')).toBeUndefined();
    expect(pickUid('   ')).toBeUndefined();
    expect(buildGroupFilter({ uid: '' })).toEqual({});
  });

  it('does not leak uid into the transaction filter (resolved in the controller)', () => {
    expect(buildTransactionFilter({ uid: '32045', orderId: 'B1' })).toEqual({
      orderId: { $regex: 'B1', $options: 'i' },
    });
  });
});

describe('group scope for ledger and order lists', () => {
  const group = { _id: 'group-object-id', groupId: '-1001234567890' };

  it('replaces the textual groupId regex with an exact, indexable scope', () => {
    const filter = buildTransactionFilter({ groupId: '32045' });
    applyGroupScope(filter, group);

    expect(filter.groupId).toBeUndefined();
    expect(filter.$or).toEqual([
      { group: 'group-object-id' },
      { groupId: '-1001234567890' },
    ]);
  });

  it('keeps the other filters (date range, enums) intact', () => {
    const filter = buildTransactionFilter({ groupId: '-1001', note: 'deposit', from: '2026-10-01' });
    applyGroupScope(filter, group);

    expect(filter.note).toBe('deposit');
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.$or).toHaveLength(2);
  });

  it('leaves the filter untouched when the group was not resolved', () => {
    const filter = buildTransactionFilter({ groupId: '-1001' });
    const before = JSON.stringify(filter);
    applyGroupScope(filter, null);
    expect(JSON.stringify(filter)).toBe(before);
  });

  it('matches rows by reference OR by stored Telegram id', () => {
    // Rows written before `group` existed only carry `groupId`, so both arms
    // are required for a group's full history.
    const filter = applyGroupScope({}, group);
    expect(filter.$or.map((clause) => Object.keys(clause)[0])).toEqual(['group', 'groupId']);
  });
});
