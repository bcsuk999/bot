import { describe, expect, it } from 'vitest';
import { normalizeUpi } from '../services/blockedUpiService.js';

describe('normalizeUpi', () => {
  it('trims and lowercases', () => {
    expect(normalizeUpi('  Foo@YBL  ')).toBe('foo@ybl');
  });

  it('handles empty/null', () => {
    expect(normalizeUpi('')).toBe('');
    expect(normalizeUpi(null)).toBe('');
    expect(normalizeUpi(undefined)).toBe('');
  });
});