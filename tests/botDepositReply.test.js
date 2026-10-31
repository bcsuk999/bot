import { describe, it, expect } from 'vitest';
import { buildDepositReply } from '../services/bot/handlers/deposit.js';

const base = { orderId: 'B20260928093925967924200', amount: 400, upiId: 'merchant@paytm' };

function buttons(reply) {
  return reply.options.reply_markup.inline_keyboard.flat();
}

describe('buildDepositReply', () => {
  it('shows only order id, amount to pay and UPI id', () => {
    const reply = buildDepositReply(base);
    expect(reply.text).toBe(
      [
        'Order ID: <code>B20260928093925967924200</code>',
        'Amount to pay: ₹400.00',
        'UPI ID: <code>merchant@paytm</code>',
      ].join('\n')
    );
  });

  it('uses no emoji or bot-style header', () => {
    const reply = buildDepositReply(base);
    expect(reply.text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(reply.text).not.toMatch(/deposit requested/i);
  });

  it('gives every value its own copy button with the raw value', () => {
    const reply = buildDepositReply(base);
    const copies = buttons(reply).map((b) => b.copy_text.text);
    expect(copies).toEqual(['B20260928093925967924200', '400.00', 'merchant@paytm']);
    expect(buttons(reply).every((b) => b.copy_text)).toBe(true);
  });

  it('omits the UPI copy button when the UPI id could not be parsed', () => {
    const reply = buildDepositReply({ ...base, upiId: null });
    expect(reply.text).toContain('UPI ID: unavailable');
    expect(buttons(reply).some((b) => b.copy_text.text === 'merchant@paytm')).toBe(false);
    expect(buttons(reply)).toHaveLength(2);
  });

  it('keeps the HTML parse mode and formats decimals', () => {
    const reply = buildDepositReply({ ...base, amount: 400.5 });
    expect(reply.options.parse_mode).toBe('HTML');
    expect(reply.text).toContain('Amount to pay: ₹400.50');
    expect(buttons(reply)[1].copy_text.text).toBe('400.50');
  });
});
