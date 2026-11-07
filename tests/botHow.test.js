import { describe, it, expect } from 'vitest';
import { cmdHow, HOW_TO_USE } from '../services/bot/handlers/how.js';

describe('cmdHow', () => {
  it('returns the how-to-use guide', () => {
    expect(cmdHow()).toEqual({ text: HOW_TO_USE });
  });

  it('explains the deposit steps and automatic confirmation', () => {
    expect(HOW_TO_USE).toContain('/d 500');
    expect(HOW_TO_USE).toContain('Order ID');
    expect(HOW_TO_USE).toContain('Amount to pay');
    expect(HOW_TO_USE).toContain('UPI ID');
    expect(HOW_TO_USE).toContain('20 minutes');
    expect(HOW_TO_USE).toMatch(/automatically once it is confirmed/i);
  });

  it('includes the manual-check fallback with UTR or screenshot', () => {
    expect(HOW_TO_USE).toContain('UTR');
    expect(HOW_TO_USE).toMatch(/payment screenshot/i);
    expect(HOW_TO_USE).toMatch(/check it manually/i);
  });

  it('warns against reusing an order and shows the other commands', () => {
    expect(HOW_TO_USE).toMatch(/do not reuse the same order/i);
    expect(HOW_TO_USE).toContain('/balance');
    expect(HOW_TO_USE).toContain('/status <order id>');
    expect(HOW_TO_USE).toContain('/daily');
  });

  it('does not use the removed heading icons', () => {
    expect(HOW_TO_USE).not.toContain('📘');
    expect(HOW_TO_USE).not.toContain('📋');
  });
});
