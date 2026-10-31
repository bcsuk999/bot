import { describe, it, expect } from 'vitest';
import { buildStatusReply } from '../services/bot/handlers/status.js';

const order = {
  orderId: 'B20261031161400123456789',
  amount: 400,
  status: 'pending',
  createdAt: new Date('2026-10-31T10:44:00Z'),
  paidAt: null,
  updatedAt: new Date('2026-10-31T10:44:00Z'),
};

describe('buildStatusReply', () => {
  it('shows order id, amount, status and created on', () => {
    const reply = buildStatusReply(order);
    expect(reply.text).toBe(
      [
        'Order ID: <code>B20261031161400123456789</code>',
        'Amount: ₹400.00',
        'Status: pending',
        'Created on: 31/10/2026, 16:14',
      ].join('\n')
    );
    expect(reply.options.parse_mode).toBe('HTML');
  });

  it('does not show a success line while the order is pending', () => {
    const reply = buildStatusReply(order);
    expect(reply.text).not.toContain('Success on');
  });

  it('adds the success time from paidAt when the order is credited', () => {
    const reply = buildStatusReply({
      ...order,
      status: 'success',
      paidAt: new Date('2026-10-31T10:46:00Z'),
      updatedAt: new Date('2026-10-31T10:46:30Z'),
    });
    expect(reply.text).toContain('Status: success');
    expect(reply.text).toContain('Success on: 31/10/2026, 16:16');
  });

  it('falls back to updatedAt for a legacy success without paidAt', () => {
    const reply = buildStatusReply({
      ...order,
      status: 'success',
      paidAt: null,
      updatedAt: new Date('2026-10-31T10:47:00Z'),
    });
    expect(reply.text).toContain('Success on: 31/10/2026, 16:17');
  });

  it('does not add a success line for failed or expired orders', () => {
    for (const status of ['failed', 'expired', 'reversed']) {
      const reply = buildStatusReply({ ...order, status });
      expect(reply.text).toContain(`Status: ${status}`);
      expect(reply.text).not.toContain('Success on');
    }
  });

  it('reports a missing order without leaking anything else', () => {
    expect(buildStatusReply(null)).toEqual({ text: 'Order not found in this group.' });
  });
});
