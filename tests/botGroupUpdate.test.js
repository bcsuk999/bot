import { describe, expect, it } from 'vitest';
import {
  normalizeGroupTitle,
  normalizeExchangeRate,
  GROUP_TITLE_MAX,
} from '../services/botGroupService.js';

describe('normalizeGroupTitle', () => {
  it('trims a valid title', () => {
    expect(normalizeGroupTitle('  Test Group  ')).toBe('Test Group');
  });

  it('rejects an empty title', () => {
    expect(() => normalizeGroupTitle('   ')).toThrow(/title cannot be empty/);
    expect(() => normalizeGroupTitle(null)).toThrow(/title cannot be empty/);
  });

  it('rejects a title longer than the limit', () => {
    expect(() => normalizeGroupTitle('x'.repeat(GROUP_TITLE_MAX + 1))).toThrow(/at most/);
    expect(normalizeGroupTitle('x'.repeat(GROUP_TITLE_MAX))).toHaveLength(GROUP_TITLE_MAX);
  });
});

describe('normalizeExchangeRate', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(normalizeExchangeRate(160)).toBe(160);
    expect(normalizeExchangeRate('160.5')).toBe(160.5);
  });

  it('treats null/empty as clearing the rate', () => {
    expect(normalizeExchangeRate(null)).toBeNull();
    expect(normalizeExchangeRate('')).toBeNull();
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(() => normalizeExchangeRate(0)).toThrow(/greater than 0/);
    expect(() => normalizeExchangeRate(-1)).toThrow(/greater than 0/);
    expect(() => normalizeExchangeRate('abc')).toThrow(/greater than 0/);
  });
});
