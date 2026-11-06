import { describe, it, expect } from 'vitest';
import { generateSign, verifySign } from '../services/simplypay.js';

const SECRET = 'test-secret';
const payload = {
  orderStatus: 2,
  orderNo: 'dfdd0d8bff97e41444e2baba980791',
  merOrderNo: 'PO20261106033035530299036',
  amount: 4450,
  currency: 'INR',
  attach: 'withdraw_PO20261106033035530299036',
  createTime: 1793935836818,
  updateTime: 1793936207898,
};

describe('SimplyPay webhook signature', () => {
  it('verifies a signature generated with the shared secret', () => {
    const sign = generateSign(payload, SECRET);
    expect(verifySign({ ...payload, sign }, SECRET)).toBe(true);
  });

  it('rejects a signature generated without the shared secret', () => {
    const sign = generateSign(payload);
    expect(verifySign({ ...payload, sign }, SECRET)).toBe(false);
  });

  it('rejects a missing or tampered signature', () => {
    expect(verifySign(payload, SECRET)).toBe(false);
    expect(verifySign({ ...payload, sign: 'deadbeef' }, SECRET)).toBe(false);
  });

  it('handles flat gateway payloads with extra: null', () => {
    const flat = { ...payload, extra: null, receiptUrl: '617571919103' };
    const sign = generateSign(flat, SECRET);
    expect(verifySign({ ...flat, sign }, SECRET)).toBe(true);
  });
});
