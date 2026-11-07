import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  generateSign,
  verifySign,
  createPaymentOrder,
  isConfigured,
} from '../services/ospay.js';

const KEY = 'test-merchant-key';

function md5Upper(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OSPAY signature', () => {
  it('sorts keys, skips empty values and uppercases the md5', () => {
    const params = { order_id: 'B1', mer_id: '10005', amount: '500' };
    const expected = md5Upper('amount=500&mer_id=10005&order_id=B1&key=' + KEY);
    expect(generateSign(params, KEY)).toBe(expected);
    expect(generateSign(params, KEY)).toMatch(/^[A-F0-9]{32}$/);
  });

  it('ignores empty values and the sign field itself', () => {
    const withNoise = { b: '2', a: '1', empty: '', sign: 'IGNORED' };
    expect(generateSign(withNoise, KEY)).toBe(generateSign({ a: '1', b: '2' }, KEY));
  });

  it('verifies a callback using only the signed fields', () => {
    const body = {
      mer_id: '10005',
      order_id: 'B1',
      status: 'OK',
      amount: '500',
      realpay: '500',
      remark: 'botospay_B1',
    };
    body.sign = generateSign(
      {
        mer_id: body.mer_id,
        order_id: body.order_id,
        status: body.status,
        amount: body.amount,
        realpay: body.realpay,
      },
      KEY
    );

    expect(verifySign(body, { merchantKey: KEY })).toBe(true);
    expect(verifySign({ ...body, amount: '499' }, { merchantKey: KEY })).toBe(false);
    expect(verifySign({ ...body, sign: '' }, { merchantKey: KEY })).toBe(false);
  });
});

describe('OSPAY configuration', () => {
  it('requires merchant id, key, callback and notify URLs', () => {
    expect(isConfigured()).toBe(false);

    vi.stubEnv('OSPAY_MERCHANT_ID', '10005');
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    expect(isConfigured()).toBe(false);

    vi.stubEnv('OSPAY_CALLBACK_URL', 'https://x.dev/return');
    vi.stubEnv('OSPAY_NOTIFY_URL', 'https://x.dev/webhook/ospay/bot');
    expect(isConfigured()).toBe(true);
  });
});

describe('OSPAY createPaymentOrder', () => {
  function stubConfig() {
    vi.stubEnv('OSPAY_MERCHANT_ID', '10005');
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    vi.stubEnv('OSPAY_CALLBACK_URL', 'https://x.dev/return');
    vi.stubEnv('OSPAY_NOTIFY_URL', 'https://x.dev/webhook/ospay/bot');
    vi.stubEnv('OSPAY_BASE_URL', 'https://ospayi.top');
    vi.stubEnv('OSPAY_GATEWAY', '1001');
  }

  it('posts a form with a browser User-Agent and a signed integer amount', async () => {
    stubConfig();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 0,
          data: 'https://ospayi.top/pay/abc',
          upi: 'merchant@oksbi',
          order_code: 'S123',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPaymentOrder({
      orderId: 'B1',
      amount: 500,
      remark: 'botospay_B1',
      userId: '42',
    });

    expect(res.code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ospayi.top/api/pay');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.headers['User-Agent']).toMatch(/Mozilla/);

    const body = new URLSearchParams(options.body);
    expect(body.get('mer_id')).toBe('10005');
    expect(body.get('order_id')).toBe('B1');
    expect(body.get('gateway')).toBe('1001');
    expect(body.get('amount')).toBe('500');
    expect(body.get('callback')).toBe('https://x.dev/return');
    expect(body.get('notify')).toBe('https://x.dev/webhook/ospay/bot');
    expect(body.get('remark')).toBe('botospay_B1');
    expect(body.get('user_id')).toBe('42');
    expect(body.get('sign')).toBe(
      generateSign(
        {
          mer_id: '10005',
          order_id: 'B1',
          gateway: '1001',
          amount: '500',
          callback: 'https://x.dev/return',
          notify: 'https://x.dev/webhook/ospay/bot',
        },
        KEY
      )
    );
  });

  it('rejects a decimal amount before calling the gateway', async () => {
    stubConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createPaymentOrder({ orderId: 'B1', amount: 500.5 })).rejects.toThrow(/whole number/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a synthetic error for a non-JSON response', async () => {
    stubConfig();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 502, text: async () => '<html>bad gateway</html>' })
    );

    const res = await createPaymentOrder({ orderId: 'B1', amount: 500 });
    expect(res.code).toBe(-1);
    expect(res.message).toMatch(/non-JSON/);
  });
});
