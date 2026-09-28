import { describe, it, expect } from 'vitest';
import { parseDepositAmount } from '../services/bot/handlers/deposit.js';

const bounds = { min: 100, max: 100000 };

describe('parseDepositAmount', () => {
  it('accepts a plain integer', () => {
    expect(parseDepositAmount('400', bounds)).toEqual({ ok: true, amount: 400 });
  });

  it('accepts a decimal', () => {
    expect(parseDepositAmount('400.50', bounds)).toEqual({ ok: true, amount: 400.5 });
  });

  it('accepts a number as well as a string', () => {
    expect(parseDepositAmount(400, bounds)).toEqual({ ok: true, amount: 400 });
  });

  it('trims whitespace', () => {
    expect(parseDepositAmount('  400  ', bounds)).toEqual({ ok: true, amount: 400 });
  });

  it('rejects a missing value with usage', () => {
    expect(parseDepositAmount(undefined, bounds).reason).toBe('usage');
    expect(parseDepositAmount(null, bounds).reason).toBe('usage');
    expect(parseDepositAmount('', bounds).reason).toBe('usage');
    expect(parseDepositAmount('   ', bounds).reason).toBe('usage');
  });

  it('rejects non-numeric input', () => {
    expect(parseDepositAmount('abc', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('NaN', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('Infinity', bounds).reason).toBe('invalid');
  });

  it('rejects zero and negative values', () => {
    expect(parseDepositAmount('0', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('-400', bounds).reason).toBe('invalid');
  });

  it('rejects currency symbols and thousands separators', () => {
    expect(parseDepositAmount('₹400', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('Rs400', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('1,000', bounds).reason).toBe('invalid');
    expect(parseDepositAmount('400 INR', bounds).reason).toBe('invalid');
  });

  it('rejects amounts below the configured minimum', () => {
    expect(parseDepositAmount('99.99', bounds).reason).toBe('below_min');
    expect(parseDepositAmount('1', bounds).reason).toBe('below_min');
  });

  it('rejects amounts above the configured maximum', () => {
    expect(parseDepositAmount('100001', bounds).reason).toBe('above_max');
    expect(parseDepositAmount('99999999', bounds).reason).toBe('above_max');
  });

  it('accepts the exact bounds inclusively', () => {
    expect(parseDepositAmount('100', bounds)).toEqual({ ok: true, amount: 100 });
    expect(parseDepositAmount('100000', bounds)).toEqual({ ok: true, amount: 100000 });
  });

  it('honours custom bounds', () => {
    const custom = { min: 10, max: 20 };
    expect(parseDepositAmount('15', custom)).toEqual({ ok: true, amount: 15 });
    expect(parseDepositAmount('50', custom).reason).toBe('above_max');
  });
});
