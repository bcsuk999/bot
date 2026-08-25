const ExchangeRate = require('../models/ExchangeRate');
const { getRateFor } = require('./adminExchangeController');

// Fallback rate as per spec: 1$ = 112 INR — used when admin has not configured a rate yet
const FALLBACK_RATE = 112;

async function resolveRate() {
  try {
    // Use shared admin logic: global active USDT rate else any active else fallback
    // getRateFor already handles DB lookup, but its default fallback is 1 — we override to 112
    const rate = await getRateFor('USDT', null);
    if (rate != null && !isNaN(Number(rate)) && Number(rate) > 0 && Number(rate) !== 1) {
      return Number(rate);
    }
    // If getRateFor returned 1, it means no configured rate — check directly for 1 vs fallback distinction
    const global = await ExchangeRate.findOne({ currency: 'USDT', network: null, isActive: true }).lean();
    if (global && global.rate != null) {
      const r = parseFloat(global.rate.toString());
      if (!isNaN(r) && r > 0) return r;
    }
    const any = await ExchangeRate.findOne({ currency: 'USDT', isActive: true }).lean();
    if (any && any.rate != null) {
      const r = parseFloat(any.rate.toString());
      if (!isNaN(r) && r > 0) return r;
    }
  } catch (_) {
    // ignore db errors -> fallback
  }
  return FALLBACK_RATE;
}

/**
 * GET /api/user/payin/exchange
 * Returns current exchange rate (single rate, no currency param).
 * Admin can change anytime via POST /api/admin/exchange-rates {currency:"USDT", rate:115}
 * Public/optionalAuth — works without token and with valid token; invalid token -> 401 via middleware.
 * Response: { success:true, rate:112 }
 */
exports.getPayinExchangeRate = async (req, res) => {
  try {
    const rate = await resolveRate();
    return res.json({ success: true, rate });
  } catch (err) {
    return res.json({ success: true, rate: FALLBACK_RATE });
  }
};

exports.FALLBACK_RATE = FALLBACK_RATE;
exports.resolveRate = resolveRate;
