import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateSign } from '../services/ospay.js';
import { botCallback } from '../controllers/ospayController.js';

const KEY = 'test-merchant-key';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.type = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

function validBody(overrides = {}) {
  const body = {
    mer_id: '10005',
    order_id: 'B1',
    status: 'OK',
    amount: '500',
    realpay: '500',
    remark: 'botospay_B1',
    ...overrides,
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
  return body;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('OSPAY webhook', () => {
  it('verifies the sign, settles the order and answers the literal ok', async () => {
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    const settle = vi.fn().mockResolvedValue({ ok: true, action: 'credited' });
    const res = mockRes();

    await botCallback({ body: validBody() }, res, settle);

    expect(settle).toHaveBeenCalledWith('B1', 'OK');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('ok');
  });

  it('rejects a bad signature without settling', async () => {
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    const settle = vi.fn();
    const res = mockRes();
    const body = validBody();
    body.amount = '999'; // tampered after signing

    await botCallback({ body }, res, settle);

    expect(settle).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('fail');
  });

  it('rejects a callback with no order id', async () => {
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    const settle = vi.fn();
    const res = mockRes();

    await botCallback({ body: { sign: 'X' } }, res, settle);

    expect(settle).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('fail');
  });

  it('answers fail when settlement throws so the gateway retries', async () => {
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    const settle = vi.fn().mockRejectedValue(new Error('db down'));
    const res = mockRes();

    await botCallback({ body: validBody() }, res, settle);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('fail');
  });

  it('passes the error status through for a failed collection', async () => {
    vi.stubEnv('OSPAY_MERCHANT_KEY', KEY);
    const settle = vi.fn().mockResolvedValue({ ok: true, action: 'failed' });
    const res = mockRes();

    await botCallback({ body: validBody({ status: 'error' }) }, res, settle);

    expect(settle).toHaveBeenCalledWith('B1', 'error');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('ok');
  });
});
