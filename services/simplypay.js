const crypto = require('crypto');

const BASE_URL = process.env.SIMPLYPAY_BASE_URL || 'https://api.paysimply.net/api/v2';
const APP_ID = process.env.SIMPLYPAY_APP_ID;
const SECRET = process.env.SIMPLYPAY_SECRET;

function generateSign(params) {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] != null && params[k] !== '')
    .sort();

  const parts = [];
  for (const key of sorted) {
    const val = params[key];
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const subKeys = Object.keys(val).sort();
      const subParts = subKeys.map((sk) => `${sk}=${val[sk]}`).join('&');
      parts.push(`${key}=${subParts}`);
    } else {
      parts.push(`${key}=${val}`);
    }
  }

  const str = parts.join('&') + '&key=' + SECRET;
  return crypto.createHash('sha256').update(str).digest('hex');
}

function verifySign(params) {
  const { sign, ...rest } = params;
  if (!sign) return false;
  return generateSign(rest) === sign;
}

async function apiCall(path, body) {
  const url = BASE_URL + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('SimplyPay API non-JSON response from', url, 'status:', res.status, 'body:', text.substring(0, 500));
    return { code: -1, msg: `API returned non-JSON (status ${res.status})` };
  }
}

async function createPaymentOrder({ merOrderNo, amount, returnUrl, notifyUrl, attach, extra }) {
  const params = {
    appId: APP_ID,
    merOrderNo,
    currency: 'INR',
    amount: String(amount),
    returnUrl: returnUrl || process.env.SIMPLYPAY_RETURN_URL,
    notifyUrl: notifyUrl || process.env.SIMPLYPAY_NOTIFY_URL,
    attach: attach || '',
    extra: extra || {},
  };
  params.sign = generateSign(params);
  return apiCall('/payment/order/create', params);
}

async function createPayoutOrder({ merOrderNo, amount, notifyUrl, attach, extra }) {
  const params = {
    appId: APP_ID,
    merOrderNo,
    currency: 'INR',
    amount: String(amount),
    notifyUrl: notifyUrl || process.env.SIMPLYPAY_PAYOUT_NOTIFY_URL,
    attach: attach || '',
    extra: extra || {},
  };
  params.sign = generateSign(params);
  return apiCall('/payout/order/create', params);
}

async function queryOrder(merOrderNo) {
  const params = {
    appId: APP_ID,
    merOrderNo,
  };
  params.sign = generateSign(params);
  const qs = new URLSearchParams(params).toString();
  const url = BASE_URL + '/payment/order/query?' + qs;
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('SimplyPay query non-JSON response from', url, 'status:', res.status, 'body:', text.substring(0, 500));
    return { code: -1, msg: `API returned non-JSON (status ${res.status})` };
  }
}

module.exports = {
  generateSign,
  verifySign,
  createPaymentOrder,
  createPayoutOrder,
  queryOrder,
};
