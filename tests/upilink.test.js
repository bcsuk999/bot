import { describe, it, expect } from 'vitest';
import { parseUpiLink, canBeButtonUrl } from '../services/bot/upilink.js';

describe('parseUpiLink', () => {
  it('parses a full UPI intent link', () => {
    const r = parseUpiLink('upi://pay?pa=merchant@paytm&pn=SubnPay&tr=REF123&am=400.00&cu=INR&tn=Deposit');
    expect(r.valid).toBe(true);
    expect(r.upiId).toBe('merchant@paytm');
    expect(r.upiAmount).toBe(400);
    expect(r.txnRef).toBe('REF123');
    expect(r.payeeName).toBe('SubnPay');
    expect(r.note).toBe('Deposit');
  });

  it('parses the minimal link shape', () => {
    const r = parseUpiLink('upi://pay?pa=merchant@paytm&am=400.00&tr=REF123');
    expect(r.valid).toBe(true);
    expect(r.upiId).toBe('merchant@paytm');
    expect(r.upiAmount).toBe(400);
    expect(r.txnRef).toBe('REF123');
  });

  it('falls back to the order amount when am is missing', () => {
    const r = parseUpiLink('upi://pay?pa=merchant@paytm', 500);
    expect(r.valid).toBe(true);
    expect(r.upiAmount).toBe(500);
  });

  it('falls back when am is empty or unparseable', () => {
    expect(parseUpiLink('upi://pay?pa=m@paytm&am=', 250).upiAmount).toBe(250);
    expect(parseUpiLink('upi://pay?pa=m@paytm&am=abc', 250).upiAmount).toBe(250);
    expect(parseUpiLink('upi://pay?pa=m@paytm&am=0', 250).upiAmount).toBe(250);
    expect(parseUpiLink('upi://pay?pa=m@paytm&am=-5', 250).upiAmount).toBe(250);
  });

  it('has a null amount when there is no am and no fallback', () => {
    expect(parseUpiLink('upi://pay?pa=merchant@paytm').upiAmount).toBeNull();
  });

  it('is invalid when pa is missing', () => {
    const r = parseUpiLink('upi://pay?am=400&tr=R1');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing_or_invalid_vpa');
    expect(r.upiId).toBeNull();
  });

  it.each([
    ['no @', 'upi://pay?pa=merchantpaytm'],
    ['empty local part', 'upi://pay?pa=@paytm'],
    ['empty handle', 'upi://pay?pa=merchant@'],
    ['space inside', 'upi://pay?pa=mer chant@paytm'],
  ])('rejects a malformed VPA (%s)', (_label, link) => {
    expect(parseUpiLink(link).valid).toBe(false);
  });

  it('rejects a non-upi scheme', () => {
    const r = parseUpiLink('https://pay.example.com/upi?pa=merchant@paytm');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('wrong_scheme');
  });

  it('rejects unparseable and empty input', () => {
    expect(parseUpiLink('').reason).toBe('empty_link');
    expect(parseUpiLink('   ').reason).toBe('empty_link');
    expect(parseUpiLink(null).reason).toBe('empty_link');
    expect(parseUpiLink(undefined).reason).toBe('empty_link');
    expect(parseUpiLink(12345).reason).toBe('empty_link');
    expect(parseUpiLink('not a url').reason).toBe('unparseable_link');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseUpiLink('  upi://pay?pa=merchant@paytm&am=10  ').valid).toBe(true);
  });
});

describe('canBeButtonUrl', () => {
  it('accepts http and https only', () => {
    expect(canBeButtonUrl('https://pay.example.com/x')).toBe(true);
    expect(canBeButtonUrl('http://pay.example.com/x')).toBe(true);
  });

  it('rejects the upi scheme, which Telegram buttons do not accept', () => {
    expect(canBeButtonUrl('upi://pay?pa=merchant@paytm')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(canBeButtonUrl('')).toBe(false);
    expect(canBeButtonUrl(null)).toBe(false);
    expect(canBeButtonUrl(undefined)).toBe(false);
  });
});
