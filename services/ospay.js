const crypto = require('crypto');
const logger = require('../utils/logger');

const DEFAULT_BASE_URL = 'https://ospayi.top';

// OSPAY blocks requests that do not look like a normal browser. Every call sends
// this User-Agent, exactly as the integration doc requires.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// The doc marks these fields "Signed = Yes". Fields like `remark`, `realname`,
// `player_ip` and `user_id` are explicitly excluded from the signature.
const CREATE_SIGNED = ['mer_id', 'order_id', 'gateway', 'amount', 'callback', 'notify'];
const CALLBACK_SIGNED = ['mer_id', 'order_id', 'status', 'amount', 'realpay'];
const QUERY_SIGNED = ['mer_id', 'order_id'];
const BALANCE_SIGNED = ['mer_id'];

function cfg() {
  return {
    baseUrl: String(process.env.OSPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    merchantId: process.env.OSPAY_MERCHANT_ID || '',
    merchantKey: process.env.OSPAY_MERCHANT_KEY || '',
    gateway: process.env.OSPAY_GATEWAY || '1001',
    callbackUrl: process.env.OSPAY_CALLBACK_URL || '',
    notifyUrl: process.env.OSPAY_NOTIFY_URL || '',
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.merchantId && c.merchantKey && c.callbackUrl && c.notifyUrl);
}

function pick(params = {}, fields = []) {
  const out = {};
  for (const field of fields) {
    const value = params[field];
    if (value == null || String(value) === '') continue;
    out[field] = value;
  }
  return out;
}

/**
 * OSPAY signature:
 *   UPPERCASE(md5(sorted non-empty k=v joined by & + "&key=" + merchant_key))
 *
 * Only the fields passed in are signed, so callers pass exactly the doc's
 * "Signed = Yes" fields for the endpoint they are calling.
 */
function generateSign(params = {}, merchantKey = cfg().merchantKey) {
  const pairs = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] != null && String(params[key]) !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`);
  const base = pairs.length ? pairs.join('&') : '';
  const stringToSign = base ? `${base}&key=${merchantKey}` : `key=${merchantKey}`;
  return crypto.createHash('md5').update(stringToSign, 'utf8').digest('hex').toUpperCase();
}

/**
 * Verify an OSPAY callback. The callback carries `remark` (and sometimes other
 * unsigned fields), so only CALLBACK_SIGNED fields are used to rebuild the sign.
 */
function verifySign(params = {}, { merchantKey = cfg().merchantKey, fields = CALLBACK_SIGNED } = {}) {
  const sign = params?.sign;
  if (!sign || !merchantKey) return false;
  const expected = generateSign(pick(params, fields), merchantKey);
  return expected === String(sign).trim().toUpperCase();
}

async function postForm(path, body) {
  const url = cfg().baseUrl + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': BROWSER_UA,
      Accept: 'application/json, text/plain, */*',
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  logger.info({ path, status: res.status }, 'OSPAY apiCall');
  try {
    return JSON.parse(text);
  } catch (err) {
    logger.error({ url, status: res.status }, 'OSPAY API non-JSON response');
    return { code: -1, message: `API returned non-JSON (status ${res.status})` };
  }
}

/**
 * Create a collection order.
 *
 * `amount` must be a positive integer: the doc explicitly forbids decimals.
 * Response: { code, data (payment URL), upi, amount, order_code, token, message }
 */
async function createPaymentOrder({
  orderId,
  amount,
  callbackUrl,
  notifyUrl,
  gateway,
  remark,
  realname,
  playerIp,
  userId,
} = {}) {
  const c = cfg();
  const numericAmount = Number(amount);
  if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
    throw new Error('OSPAY amount must be a positive whole number');
  }

  const signed = {
    mer_id: c.merchantId,
    order_id: orderId,
    gateway: gateway || c.gateway,
    amount: String(numericAmount),
    callback: callbackUrl || c.callbackUrl,
    notify: notifyUrl || c.notifyUrl,
  };

  const body = { ...signed };
  // Unsigned, optional fields. Sent only when provided.
  if (remark) body.remark = remark;
  if (realname) body.realname = realname;
  if (playerIp) body.player_ip = playerIp;
  if (userId) body.user_id = userId;
  body.sign = generateSign(signed, c.merchantKey);

  logger.debug({ orderId, amount: numericAmount }, 'OSPAY createPaymentOrder');
  return postForm('/api/pay', body);
}

async function queryOrder(orderId) {
  const c = cfg();
  const signed = { mer_id: c.merchantId, order_id: orderId };
  const body = { ...signed, sign: generateSign(signed, c.merchantKey) };
  return postForm('/api/status/ds', body);
}

async function queryBalance() {
  const c = cfg();
  const signed = { mer_id: c.merchantId };
  const body = { ...signed, sign: generateSign(signed, c.merchantKey) };
  return postForm('/api/balance', body);
}

module.exports = {
  BROWSER_UA,
  CREATE_SIGNED,
  CALLBACK_SIGNED,
  QUERY_SIGNED,
  BALANCE_SIGNED,
  cfg,
  isConfigured,
  generateSign,
  verifySign,
  createPaymentOrder,
  queryOrder,
  queryBalance,
};
