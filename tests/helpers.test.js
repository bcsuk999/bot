import { describe, it, expect } from 'vitest';
import { parseBalance, generateOrderId } from '../utils/helpers.js';

describe('parseBalance', () => {
  it('returns 0 for null/undefined', () => {
    expect(parseBalance(null)).toBe(0);
    expect(parseBalance(undefined)).toBe(0);
  });

  it('converts Decimal128-like objects to number', () => {
    const mockDecimal = { toString: () => '500.75' };
    expect(parseBalance(mockDecimal)).toBe(500.75);
  });

  it('converts string numbers to number', () => {
    expect(parseBalance('123.45')).toBe(123.45);
  });

  it('returns number as-is', () => {
    expect(parseBalance(42)).toBe(42);
  });

  it('returns 0 for NaN values', () => {
    expect(parseBalance('notanumber')).toBe(0);
  });

  it('handles zero', () => {
    expect(parseBalance(0)).toBe(0);
  });
});

describe('generateOrderId', () => {
  it('returns time-based ID with no prefix', () => {
    const result = generateOrderId();
    expect(result).toMatch(/^\d{23}$/);
  });

  it('includes the prefix when provided', () => {
    const result = generateOrderId('P');
    expect(result).toMatch(/^P\d{23}$/);
  });

  it('returns IDs of consistent length regardless of prefix', () => {
    const txn = generateOrderId('TXN');
    const po = generateOrderId('PO');
    expect(txn).toMatch(/^TXN\d{23}$/);
    expect(po).toMatch(/^PO\d{23}$/);
  });

  it('starts with current local date YYYYMMDD', () => {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const result = generateOrderId();
    expect(result.startsWith(ymd)).toBe(true);
  });

  it('generates unique IDs for consecutive calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateOrderId()));
    expect(ids.size).toBe(1000);
  });
});
