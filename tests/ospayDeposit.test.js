import { describe, it, expect } from 'vitest';
import { parseOspayAmount, amountRejection } from '../services/bot/handlers/ospayDeposit.js';

const limits = { min: 100, max: 100000 };

describe('parseOspayAmount', () => {
  it('accepts a whole number inside the limits', () => {
    expect(parseOspayAmount('500', limits)).toEqual({ ok: true, amount: 500 });
    expect(parseOspayAmount('100', limits)).toEqual({ ok: true, amount: 100 });
    expect(parseOspayAmount('100000', limits)).toEqual({ ok: true, amount: 100000 });
  });

  it('rejects decimals because OSPAY only accepts integers', () => {
    expect(parseOspayAmount('500.50', limits)).toEqual({ ok: false, reason: 'integer' });
    expect(parseOspayAmount('0.5', limits)).toEqual({ ok: false, reason: 'integer' });
  });

  it('rejects currency symbols, commas and negatives', () => {
    expect(parseOspayAmount('₹500', limits).reason).toBe('integer');
    expect(parseOspayAmount('1,000', limits).reason).toBe('integer');
    expect(parseOspayAmount('-500', limits).reason).toBe('integer');
  });

  it('enforces the deposit bounds', () => {
    expect(parseOspayAmount('99', limits)).toEqual({ ok: false, reason: 'below_min', min: 100 });
    expect(parseOspayAmount('100001', limits)).toEqual({
      ok: false,
      reason: 'above_max',
      max: 100000,
    });
  });

  it('asks for an amount when none is given', () => {
    expect(parseOspayAmount('', limits)).toEqual({ ok: false, reason: 'usage' });
    expect(parseOspayAmount(null, limits)).toEqual({ ok: false, reason: 'usage' });
  });

  it('renders a helpful rejection for every reason', () => {
    expect(amountRejection({ reason: 'usage' })).toContain('/osd <amount>');
    expect(amountRejection({ reason: 'integer' })).toContain('whole number');
    expect(amountRejection({ reason: 'below_min', min: 100 })).toContain('₹100.00');
    expect(amountRejection({ reason: 'above_max', max: 100000 })).toContain('₹1,00,000.00');
  });
});
