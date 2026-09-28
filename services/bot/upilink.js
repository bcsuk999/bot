// Pure helpers for parsing the upi:// deep links the payment gateway returns.
// No I/O, no logging - fully unit-testable.

// pa = payee VPA, am = amount, tr = gateway txn ref, tn = note, pn = payee name
const VPA_PATTERN = /^[\w.\-]{1,256}@[\w.\-]{1,64}$/;

/**
 * Parse a upi:// deep link into its parts.
 *
 * @param {string} deepLink  e.g. "upi://pay?pa=merchant@paytm&am=400.00&tr=REF123"
 * @param {number} [fallbackAmount]  used when the link carries no usable `am`
 * @returns {{ valid: boolean, upiId: string|null, upiAmount: number|null,
 *             txnRef: string|null, payeeName: string|null, note: string|null,
 *             reason: string|null }}
 */
function parseUpiLink(deepLink, fallbackAmount = null) {
  const empty = {
    valid: false,
    upiId: null,
    upiAmount: null,
    txnRef: null,
    payeeName: null,
    note: null,
    reason: null,
  };

  if (typeof deepLink !== 'string' || !deepLink.trim()) {
    return { ...empty, reason: 'empty_link' };
  }

  let url;
  try {
    url = new URL(deepLink.trim());
  } catch (err) {
    return { ...empty, reason: 'unparseable_link' };
  }

  if (url.protocol !== 'upi:') {
    return { ...empty, reason: 'wrong_scheme' };
  }

  const pa = url.searchParams.get('pa');
  if (!pa || !VPA_PATTERN.test(pa.trim())) {
    return { ...empty, reason: 'missing_or_invalid_vpa' };
  }

  const am = url.searchParams.get('am');
  let upiAmount = null;
  if (am != null && String(am).trim() !== '') {
    const n = Number(String(am).trim());
    if (Number.isFinite(n) && n > 0) upiAmount = n;
  }
  if (upiAmount == null) {
    upiAmount = Number.isFinite(fallbackAmount) && fallbackAmount > 0 ? fallbackAmount : null;
  }

  const tr = url.searchParams.get('tr');
  const pn = url.searchParams.get('pn');
  const tn = url.searchParams.get('tn');

  return {
    valid: true,
    upiId: pa.trim(),
    upiAmount,
    txnRef: tr && tr.trim() ? tr.trim() : null,
    payeeName: pn && pn.trim() ? pn.trim() : null,
    note: tn && tn.trim() ? tn.trim() : null,
    reason: null,
  };
}

// Telegram rejects most non-http(s) schemes in inline keyboard URL buttons, so
// callers need to know whether a button can be built or only plain text.
function canBeButtonUrl(link) {
  if (typeof link !== 'string' || !link.trim()) return false;
  return /^https?:\/\//i.test(link.trim());
}

module.exports = { parseUpiLink, canBeButtonUrl, VPA_PATTERN };
