const crypto = require('crypto');
const logger = require('../utils/logger');

const BASE_URL = process.env.SIMPLYPAY_BASE_URL || 'https://api.paysimply.net/api/v2';
const APP_ID = process.env.SIMPLYPAY_APP_ID;
const SECRET = process.env.SIMPLYPAY_SECRET;

function parseExtra(ext) {
  if (!ext || typeof ext !== 'object') {
    return null;
  }
  const extra = { ...ext };
  const keys = Object.keys(extra);
  keys.sort();

  return keys
    .map((key) => {
      const value = extra[key];
      if (value && typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${value}`;
    })
    .join('&');
}

function generateSign(params, appSecret) {
  const paramsKeys = Object.keys(params).filter((key) => key !== 'sign' && params[key]);
  paramsKeys.sort();
  let paramsString = paramsKeys
    .map((key) => {
      const value = params[key];
      if (value && typeof value === 'object') {
        return `${key}=${parseExtra(value)}`;
      }
      return `${key}=${value}`;
    })
    .join('&');
  if (appSecret) {
    paramsString += `&key=${appSecret}`;
  }
  logger.debug('SimplyPay signStr generated');
  return crypto.createHash('sha256').update(paramsString, 'utf8').digest('hex');
}

function verifySign(params, appSecret = SECRET) {
  const { sign, ...rest } = params;
  if (!sign) return false;
  // The gateway signs with the shared secret, so verification must append it
  // too. Omitting SECRET made every legitimate callback fail the check.
  return generateSign(rest, appSecret) === sign;
}

async function apiCall(path, body) {
  const url = BASE_URL + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  logger.info({ path, status: res.status }, 'SimplyPay apiCall');
  try {
    return JSON.parse(text);
  } catch (e) {
    logger.error({ url, status: res.status }, 'SimplyPay API non-JSON response');
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
  params.sign = generateSign(params, SECRET);
  logger.debug({ merOrderNo, amount }, 'SimplyPay createPaymentOrder');
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
  params.sign = generateSign(params, SECRET);
  return apiCall('/payout/order/create', params);
}

async function queryOrder(merOrderNo) {
  const params = {
    appId: APP_ID,
    merOrderNo,
  };
  params.sign = generateSign(params, SECRET);
  const qs = new URLSearchParams(params).toString();
  const url = BASE_URL + '/payment/order/query?' + qs;
  const res = await fetch(url);
  const text = await res.text();
  logger.info({ merOrderNo, status: res.status }, 'SimplyPay queryOrder');
  try {
    return JSON.parse(text);
  } catch (e) {
    logger.error({ url, status: res.status }, 'SimplyPay query non-JSON response');
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
