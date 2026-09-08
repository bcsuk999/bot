import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, clearCache } from '../utils/cache.js';

describe('cache', () => {
  beforeEach(() => {
    clearCache('test-key');
    clearCache('test-err');
  });

  it('calls loader once within TTL', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 'value';
    };

    const a = await getCached('test-key', 5000, loader);
    const b = await getCached('test-key', 5000, loader);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(calls).toBe(1);
  });

  it('expires after TTL and reloads', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    await getCached('test-key', 10, loader);
    await new Promise((r) => setTimeout(r, 20));
    await getCached('test-key', 10, loader);
    expect(calls).toBe(2);
  });

  it('drops a failed load so retries are possible', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error('db down');
      return 'recovered';
    };

    await expect(getCached('test-err', 5000, loader)).rejects.toThrow('db down');
    const v = await getCached('test-err', 5000, loader);
    expect(v).toBe('recovered');
  });

  it('clearCache forces reload', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return `v${calls}`;
    };

    await getCached('test-key', 5000, loader);
    clearCache('test-key');
    const v = await getCached('test-key', 5000, loader);
    expect(v).toBe('v2');
  });
});