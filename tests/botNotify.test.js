import { describe, it, expect } from 'vitest';
import { buildSuccessNotice, buildFailedNotice } from '../controllers/botWebhookController.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('buildSuccessNotice', () => {
  it('shows the completed-order slip', () => {
    const text = buildSuccessNotice({ orderId: 'B20260928093925967924200', amount: 400, balance: 12900 });
    expect(text).toBe(
      [
        'Order completed 💕',
        '',
        'Order type: Payment Order',
        'Order No: B20260928093925967924200',
        'Status: Completed✅',
        'Amount: 400.00',
      ].join('\n')
    );
  });

  it('omits the balance - it is read back with /balance', () => {
    expect(buildSuccessNotice({ orderId: 'B1', amount: 400 })).not.toContain('Balance');
  });

  it('uses the heart and the checkmark as its only emoji', () => {
    const text = buildSuccessNotice({ orderId: 'B1', amount: 400 });
    expect(text.match(new RegExp(EMOJI, 'gu'))).toEqual(['💕', '✅']);
  });
});

describe('buildFailedNotice', () => {
  it('shows order id, amount and reason', () => {
    const text = buildFailedNotice({ orderId: 'B20260928093925967924200', amount: 400.5, reason: 'expired' });
    expect(text).toBe(
      ['Deposit failed', '', 'Order ID: B20260928093925967924200', 'Amount: ₹400.50', 'Reason: expired'].join('\n')
    );
  });

  it('uses no emoji', () => {
    expect(buildFailedNotice({ orderId: 'B1', amount: 400, reason: 'status -1' })).not.toMatch(EMOJI);
  });
});
