import { describe, expect, it } from 'vitest';
import {
  GATEWAY_FEE_RATE,
  parseIstDate,
  parsePlArgs,
  computePnl,
  renderPnlBlock,
  renderPnlReport,
  summarizeRatedRows,
  chunkText,
  formatSignedInr,
  formatPnlWithEmoji,
} from '../services/bot/pnl.js';

describe('parseIstDate', () => {
  it('parses DD/MM/YY as an IST day', () => {
    const day = parseIstDate('23/11/26');
    expect(day).not.toBeNull();
    expect(day.label).toBe('23/11/2026');
    expect(day.start.toISOString()).toBe('2026-11-22T18:30:00.000Z');
    expect(day.end.toISOString()).toBe('2026-11-23T18:30:00.000Z');
  });

  it('accepts a four-digit year', () => {
    expect(parseIstDate('23/11/2026').label).toBe('23/11/2026');
  });

  it('rejects impossible dates and malformed input', () => {
    expect(parseIstDate('31/02/26')).toBeNull();
    expect(parseIstDate('32/01/26')).toBeNull();
    expect(parseIstDate('23-11-26')).toBeNull();
    expect(parseIstDate('')).toBeNull();
    expect(parseIstDate(null)).toBeNull();
  });
});

describe('parsePlArgs', () => {
  it('returns the day window and cost for valid input', () => {
    const parsed = parsePlArgs(['23/11/26', '107']);
    expect(parsed.ok).toBe(true);
    expect(parsed.cost).toBe(107);
    expect(parsed.label).toBe('23/11/2026');
  });

  it('asks for both arguments when they are missing', () => {
    expect(parsePlArgs([]).ok).toBe(false);
    expect(parsePlArgs(['23/11/26']).text).toContain('Usage');
  });

  it('rejects an invalid date', () => {
    const parsed = parsePlArgs(['31/02/26', '107']);
    expect(parsed.ok).toBe(false);
    expect(parsed.text).toContain('Invalid date');
  });

  it('rejects a non-positive or non-numeric cost', () => {
    expect(parsePlArgs(['23/11/26', '0']).ok).toBe(false);
    expect(parsePlArgs(['23/11/26', '-5']).ok).toBe(false);
    expect(parsePlArgs(['23/11/26', 'abc']).ok).toBe(false);
  });
});

describe('computePnl', () => {
  it('applies the gateway fee to the exchange margin', () => {
    // ((160 - 107) / 160) - 0.056 = 0.27525; * 10000 = 2752.50
    expect(computePnl({ exchangeRate: 160, cost: 107, deposit: 10000 })).toBe(2752.5);
  });

  it('returns a negative number when the cost eats the margin', () => {
    // ((160 - 160) / 160) - 0.056 = -0.056; * 10000 = -560
    expect(computePnl({ exchangeRate: 160, cost: 160, deposit: 10000 })).toBe(-560);
  });

  it('returns null when the group has no usable rate', () => {
    expect(computePnl({ exchangeRate: null, cost: 107, deposit: 10000 })).toBeNull();
    expect(computePnl({ exchangeRate: 0, cost: 107, deposit: 10000 })).toBeNull();
  });

  it('uses a 5.6% gateway charge', () => {
    expect(GATEWAY_FEE_RATE).toBe(0.056);
  });
});

describe('renderPnlBlock', () => {
  const row = {
    uid: '32045',
    title: 'Test Group',
    exchangeRate: 160,
    todayDeposit: 10000,
    totalDeposit: 120000,
    todayPayout: 2000,
    totalPayout: 40000,
  };

  it('renders every requested line with the profit', () => {
    const text = renderPnlBlock(row, 107);
    expect(text).toContain('UID 32045 | 160 | P/L 🟢₹2,752.50');
    expect(text).toContain('Today ₹10,000.00 | Total ₹1,20,000.00');
    expect(text).toContain('Payout ₹40,000.00 | Today payout ₹2,000.00');
  });

  it('says the rate is not set instead of showing a wrong number', () => {
    const text = renderPnlBlock({ ...row, exchangeRate: null }, 107);
    expect(text).toContain('UID 32045 | - | P/L rate not set');
  });

  it('marks a loss in red and a profit in green', () => {
    expect(formatPnlWithEmoji(-560)).toBe('🔴-₹560.00');
    expect(formatPnlWithEmoji(2752.5)).toBe('🟢₹2,752.50');
    expect(formatPnlWithEmoji(0)).toBe('🟢₹0.00');
  });

  it('shows a loss with a minus sign', () => {
    expect(formatSignedInr(-560)).toBe('-₹560.00');
  });
});

describe('renderPnlReport', () => {
  it('lists no groups when there are none', () => {
    const text = renderPnlReport({ dateLabel: '23/11/2026', cost: 107, rows: [] });
    expect(text).toContain('No active groups with an exchange rate set');
  });

  it('puts one block per group under the date header', () => {
    const rows = [
      { uid: '11111', title: 'A', exchangeRate: 160, todayDeposit: 100, totalDeposit: 200, todayPayout: 0, totalPayout: 0 },
      { uid: '22222', title: 'B', exchangeRate: null, todayDeposit: 0, totalDeposit: 0, todayPayout: 0, totalPayout: 0 },
    ];
    const text = renderPnlReport({ dateLabel: '23/11/2026', cost: 107, rows });
    expect(text).not.toContain('P&L —');
    expect(text).toContain('UID 11111 | 160');
    expect(text).not.toContain('UID 22222');
  });

  it('excludes groups without an exchange rate entirely', () => {
    const rows = [
      { uid: '22222', title: 'B', exchangeRate: null, todayDeposit: 5000, totalDeposit: 5000, todayPayout: 0, totalPayout: 0 },
      { uid: '33333', title: 'C', exchangeRate: 0, todayDeposit: 5000, totalDeposit: 5000, todayPayout: 0, totalPayout: 0 },
    ];
    const text = renderPnlReport({ dateLabel: '23/11/2026', cost: 107, rows });
    expect(text).toContain('No active groups with an exchange rate set');
    expect(text).not.toContain('UID 22222');
    expect(text).not.toContain('UID 33333');
  });

  it('ends with totals that exclude groups without a rate', () => {
    const rows = [
      { uid: '11111', title: 'A', exchangeRate: 160, todayDeposit: 10000, totalDeposit: 20000, todayPayout: 1000, totalPayout: 3000 },
      { uid: '22222', title: 'B', exchangeRate: 200, todayDeposit: 5000, totalDeposit: 8000, todayPayout: 500, totalPayout: 2000 },
      { uid: '33333', title: 'No rate', exchangeRate: null, todayDeposit: 9999, totalDeposit: 9999, todayPayout: 9999, totalPayout: 9999 },
    ];
    const totals = summarizeRatedRows(rows, 107);
    expect(totals.groups).toBe(2);
    expect(totals.todayDeposit).toBe(15000);
    expect(totals.totalDeposit).toBe(28000);
    expect(totals.todayPayout).toBe(1500);
    expect(totals.totalPayout).toBe(5000);

    const text = renderPnlReport({ dateLabel: '23/11/2026', cost: 107, rows });
    expect(text).toContain('All groups total');
    expect(text).toContain('Today ₹15,000.00 | Total ₹28,000.00');
    expect(text).toContain('Payout ₹5,000.00 | Today payout ₹1,500.00');
  });
});

describe('chunkText', () => {
  it('returns one chunk for a short report', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('splits on block boundaries and never exceeds the limit', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => `block ${i} ${'x'.repeat(120)}`);
    const chunks = chunkText(blocks.join('\n\n'), 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it('hard-splits a single block larger than the limit', () => {
    const chunks = chunkText('x'.repeat(900), 400);
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe('x'.repeat(900));
  });
});
