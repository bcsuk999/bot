const crypto = require('crypto');

const BASE_URL = process.env.SIMPLYPAY_BASE_URL || 'https://api.paysimply.net/api/v2';
const APP_ID = process.env.SIMPLYPAY_APP_ID;
const SECRET = process.env.SIMPLYPAY_SECRET;

function parseExtra(extra) {
  const keys = Object.keys(extra).sort();
  return keys.map((k) => `${k}=${extra[k]}`).join('&');
}

function generateSign(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== null && params[k] !== undefined)
    .sort();

  const signStr = keys
    .map((k) => {
      if (typeof params[k] === 'object' && params[k] !== null && !Array.isArray(params[k])) {
        return `${k}=${parseExtra(params[k])}`;
      }
      return `${k}=${params[k]}`;
    })
    .join('&');

  const full = signStr + '&key=' + (secret || SECRET);
  return crypto.createHash('sha256').update(full, 'utf8').digest('hex');
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
  console.log('SimplyPay apiCall', path, 'status:', res.status, 'body:', text);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('SimplyPay API non-JSON response from', url, 'status:', res.status, 'body:', text);
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
  console.log('SimplyPay queryOrder status:', res.status, 'body:', text);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('SimplyPay query non-JSON response from', url, 'status:', res.status, 'body:', text);
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
