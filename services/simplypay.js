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
  return res.json();
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
  return res.json();
}

module.exports = {
  generateSign,
  verifySign,
  createPaymentOrder,
  createPayoutOrder,
  queryOrder,
};
