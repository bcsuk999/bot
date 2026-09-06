import { describe, it, expect } from 'vitest';
import { parseBalance, formatTrnId, formatPayinId, formatPayoutId } from '../utils/helpers.js';

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

describe('formatTrnId', () => {
  it('returns correct format with zero-padded seq', () => {
    const result = formatTrnId(1);
    expect(result).toMatch(/^TXN\d{8}0001$/);
  });

  it('pads 4-digit seq', () => {
    const result = formatTrnId(42);
    expect(result).toMatch(/^TXN\d{8}0042$/);
  });

  it('handles large seq numbers', () => {
    const result = formatTrnId(9999);
    expect(result).toMatch(/^TXN\d{8}9999$/);
  });

  it('includes current date in the ID', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const result = formatTrnId(1);
    expect(result).toBe(`TXN${expected}0001`);
  });
});

describe('formatPayinId', () => {
  it('returns PAY prefix by default', () => {
    const result = formatPayinId(1);
    expect(result).toMatch(/^PAY\d{8}0001$/);
  });

  it('accepts custom prefix', () => {
    const result = formatPayinId(1, 'FPAY');
    expect(result).toMatch(/^FPAY\d{8}0001$/);
  });

  it('pads seq to 4 digits', () => {
    const result = formatPayinId(100);
    expect(result).toMatch(/^PAY\d{8}0100$/);
  });
});

describe('formatPayoutId', () => {
  it('returns PAYOUT prefix', () => {
    const result = formatPayoutId(1);
    expect(result).toMatch(/^PAYOUT\d{8}0001$/);
  });

  it('pads seq to 4 digits', () => {
    const result = formatPayoutId(25);
    expect(result).toMatch(/^PAYOUT\d{8}0025$/);
  });

  it('includes current date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const result = formatPayoutId(1);
    expect(result).toBe(`PAYOUT${expected}0001`);
  });
});
