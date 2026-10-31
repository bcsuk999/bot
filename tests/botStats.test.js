import { describe, it, expect } from 'vitest';
import {
  startOfIstDay,
  formatAmount,
  formatInr,
  buildBucket,
  renderBucket,
  emptyBucket,
  formatIst,
  escapeHtml,
} from '../services/bot/format.js';
import { renderStatsReport } from '../services/bot/stats.js';

describe('startOfIstDay', () => {
  it('returns midnight IST for a mid-afternoon IST instant', () => {
    // 2026-09-28 15:30 IST == 10:00 UTC
    const now = new Date('2026-09-28T10:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('is already midnight-adjacent when called just after IST midnight', () => {
    // 2026-09-28 00:30 IST == 2026-09-27 19:00 UTC
    const now = new Date('2026-09-27T19:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('treats 18:29 UTC the previous day as still the same IST day', () => {
    // 2026-09-27 23:59 UTC == 2026-09-28 05:29 IST -> still 2026-09-28
    const now = new Date('2026-09-27T23:59:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });

  it('rolls the day at 18:30 UTC, which is midnight IST', () => {
    // 2026-09-28 19:00 UTC == 2026-09-29 00:30 IST -> new day
    const now = new Date('2026-09-28T19:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2026-09-28T18:30:00.000Z');
  });

  it('is independent of the host timezone offset', () => {
    // Same instant must always yield the same boundary regardless of host TZ.
    const now = new Date('2026-09-28T10:00:00.000Z');
    const a = startOfIstDay(now).getTime();
    const b = startOfIstDay(new Date(now.getTime())).getTime();
    expect(a).toBe(b);
    expect(new Date(a).getUTCHours()).toBe(18);
    expect(new Date(a).getUTCMinutes()).toBe(30);
  });

  it('handles a month boundary', () => {
    const now = new Date('2026-10-01T05:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('handles a year boundary', () => {
    const now = new Date('2026-01-01T05:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('handles a leap day', () => {
    const now = new Date('2028-02-29T10:00:00.000Z');
    expect(startOfIstDay(now).toISOString()).toBe('2028-02-28T18:30:00.000Z');
  });
});

describe('formatAmount / formatInr', () => {
  it('formats two decimals with Indian grouping', () => {
    expect(formatAmount(12500)).toBe('12,500.00');
    expect(formatAmount(1000000)).toBe('10,00,000.00');
  });

  it('prefixes the rupee sign', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(400)).toBe('₹400.00');
  });

  it('treats invalid input as zero', () => {
    expect(formatAmount(null)).toBe('0.00');
    expect(formatAmount(undefined)).toBe('0.00');
    expect(formatAmount('abc')).toBe('0.00');
  });
});

describe('escapeHtml', () => {
  it('escapes the html-significant characters', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('is safe for null', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('buildBucket', () => {
  it('is all-zero by default', () => {
    expect(buildBucket()).toEqual(emptyBucket());
  });

  it('sums counts and amounts per status', () => {
    const b = buildBucket({
      success: { count: 9, amount: 13900 },
      pending: { count: 2, amount: 2500 },
      failed: { count: 1, amount: 2000 },
    });
    expect(b.totalOrders).toBe(12);
    expect(b.totalAmount).toBe(18400);
    expect(b.success).toEqual({ count: 9, amount: 13900 });
  });

  it('breaks expired out into its own named bucket so the rows add up', () => {
    const b = buildBucket({ success: { count: 1, amount: 10 }, expired: { count: 2, amount: 20 } });
    expect(b.totalOrders).toBe(3);
    expect(b.totalAmount).toBe(30);
    expect(b.success).toEqual({ count: 1, amount: 10 });
    expect(b.expired).toEqual({ count: 2, amount: 20 });
    // Every counted order must appear in exactly one rendered row.
    const rows = b.success.count + b.pending.count + b.failed.count + b.expired.count + b.reversed.count;
    expect(rows).toBe(b.totalOrders);
  });

  it('still counts a genuinely unknown status in the totals only', () => {
    const b = buildBucket({ success: { count: 1, amount: 10 }, banana: { count: 5, amount: 50 } });
    expect(b.totalOrders).toBe(6);
    expect(b.totalAmount).toBe(60);
    expect(b.banana).toBeUndefined();
  });
});

describe('renderBucket', () => {
  it('renders totals plus a row per status', () => {
    const text = renderBucket('Today (IST)', buildBucket({
      success: { count: 9, amount: 13900 },
      pending: { count: 2, amount: 2500 },
      failed: { count: 1, amount: 2000 },
    }));
    expect(text).toContain('Today (IST)');
    expect(text).toContain('Total orders');
    expect(text).toContain('12');
    expect(text).toContain('₹18,400.00');
    expect(text).toContain('Success: 9');
    expect(text).toContain('Pending: 2');
    expect(text).toContain('Failed: 1');
    expect(text).not.toMatch(/[✅⏳❌]/);
  });
});

describe('renderStatsReport', () => {
  const today = buildBucket({ success: { count: 9, amount: 13900 } });
  const all = buildBucket({
    success: { count: 131, amount: 276400 },
    pending: { count: 9, amount: 21350 },
    failed: { count: 8, amount: 15000 },
  });

  it('shows both blocks plus the balance by default', () => {
    const text = renderStatsReport({ groupId: '-1001234567890', title: 'SubnPay', today, all, balance: 91200 });
    expect(text).toContain('Daily report — -1001234567890 (SubnPay)');
    expect(text).toContain('Today (IST)');
    expect(text).toContain('All time');
    expect(text).toContain('Current balance');
    expect(text).toContain('₹91,200.00');
  });

  it('renders only the today block when asked', () => {
    const text = renderStatsReport({ groupId: 'g', today, all, balance: 1, window: 'today' });
    expect(text).toContain('Today (IST)');
    expect(text).not.toContain('All time');
  });

  it('renders only the all-time block when asked', () => {
    const text = renderStatsReport({ groupId: 'g', today, all, balance: 1, window: 'all' });
    expect(text).not.toContain('Today (IST)');
    expect(text).toContain('All time');
  });

  it('omits the title segment when there is none', () => {
    const text = renderStatsReport({ groupId: 'g', today, all, balance: 0, window: 'all' });
    expect(text).toContain('Daily report — g');
  });
});

describe('formatIst', () => {
  it('formats a valid date', () => {
    expect(formatIst(new Date('2026-09-28T10:00:00.000Z'))).toMatch(/2026/);
  });

  it('falls back to a dash for missing or invalid input', () => {
    expect(formatIst(null)).toBe('-');
    expect(formatIst('not a date')).toBe('-');
  });
});
