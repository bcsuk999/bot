import { describe, it, expect } from 'vitest';
import {
  buildDepositReply,
  scheduleDepositExpiryEdit,
  EXPIRED_NOTICE_TEXT,
} from '../services/bot/handlers/deposit.js';

const base = {
  orderId: 'B20260928093925967924200',
  amount: 400,
  upiId: 'merchant@paytm',
  // 14:35 IST, exactly 20 minutes after the order was created.
  expiresAt: new Date('2026-11-06T09:05:00.000Z'),
};

function buttons(reply) {
  return reply.options.reply_markup.inline_keyboard.flat();
}

describe('buildDepositReply', () => {
  it('shows order id, amount to pay, UPI id, expiry and the warning', () => {
    const reply = buildDepositReply(base);
    expect(reply.text).toBe(
      [
        'Order ID: <code>B20260928093925967924200</code>',
        'Amount to pay: ₹400.00',
        'UPI ID: <code>merchant@paytm</code>',
        'Expires at: 2:35 pm 6 Nov 2026 [20 minutes]',
        '',
        '⚠️ Do not use the same order for multiple payments.',
      ].join('\n')
    );
  });

  it('uses no bot-style header', () => {
    const reply = buildDepositReply(base);
    expect(reply.text).not.toMatch(/deposit requested/i);
  });

  it('defaults the expiry to 20 minutes from now', () => {
    const reply = buildDepositReply({ ...base, expiresAt: undefined });
    expect(reply.text).toMatch(/Expires at: \d{1,2}:\d{2} (am|pm) \d{1,2} [A-Za-z]+ \d{4}/);
  });

  it('has copy buttons for amount and UPI id, but not for the order id', () => {
    const reply = buildDepositReply(base);
    const copies = buttons(reply).map((b) => b.copy_text.text);
    expect(copies).toEqual(['400.00', 'merchant@paytm']);
    expect(buttons(reply).some((b) => /order/i.test(b.text))).toBe(false);
  });

  it('omits the UPI copy button when the UPI id could not be parsed', () => {
    const reply = buildDepositReply({ ...base, upiId: null });
    expect(reply.text).toContain('UPI ID: unavailable');
    expect(buttons(reply)).toHaveLength(1);
    expect(buttons(reply)[0].copy_text.text).toBe('400.00');
  });

  it('renders the amount it is given (the deep-link amount)', () => {
    const reply = buildDepositReply({ ...base, amount: 1000 });
    expect(reply.text).toContain('Amount to pay: ₹1,000.00');
    // Copy value must be paste-ready: no thousands separator.
    expect(buttons(reply)[0].copy_text.text).toBe('1000.00');
  });

  it('keeps the HTML parse mode and formats decimals', () => {
    const reply = buildDepositReply({ ...base, amount: 400.5 });
    expect(reply.options.parse_mode).toBe('HTML');
    expect(reply.text).toContain('Amount to pay: ₹400.50');
    expect(buttons(reply)[0].copy_text.text).toBe('400.50');
  });
});

describe('deposit expiry notice', () => {
  it('uses the exact expired warning', () => {
    expect(EXPIRED_NOTICE_TEXT).toBe('⚠️ order expired create new for further payment');
  });

  it('does not schedule anything without a sent message or client', () => {
    expect(scheduleDepositExpiryEdit({})).toBeNull();
    expect(
      scheduleDepositExpiryEdit({
        client: {},
        chatId: 1,
        message: {},
        orderId: 'B1',
        expiresAt: new Date(),
      })
    ).toBeNull();
  });
});
