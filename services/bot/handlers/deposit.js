const BotOrder = require('../../../models/BotOrder');
const simplypay = require('../../simplypay');
const { generateOrderId } = require('../../../utils/helpers');
const { parseUpiLink, canBeButtonUrl } = require('../upilink');
const { formatInr, label, escapeHtml } = require('../format');
const { alertOwner } = require('../guard');
const logger = require('../../../utils/logger');

/**
 * Parse and bounds-check a raw /deposit argument.
 * Returns { ok: true, amount } or { ok: false, reason }.
 */
function parseDepositAmount(raw, { min, max }) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, reason: 'usage' };
  }
  const s = String(raw).trim();
  // Reject anything that is not a plain decimal number (currency symbols, commas, etc.)
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, reason: 'invalid' };
  }
  const amount = Number(s);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (amount < min) {
    return { ok: false, reason: 'below_min', min };
  }
  if (amount > max) {
    return { ok: false, reason: 'above_max', max };
  }
  return { ok: true, amount };
}

function amountRejection(parsed) {
  switch (parsed.reason) {
    case 'usage':
      return '❌ Usage: <code>/deposit &lt;amount&gt;</code>\nExample: <code>/deposit 400</code>';
    case 'below_min':
      return `❌ Minimum deposit is ${formatInr(parsed.min)}.`;
    case 'above_max':
      return `❌ Maximum deposit is ${formatInr(parsed.max)}.`;
    default:
      return '❌ Invalid amount. Use a plain number, e.g. <code>/deposit 400</code>';
  }
}

async function cmdDeposit(ctx) {
  const { group, args, config, client } = ctx;

  const parsed = parseDepositAmount(args[0], { min: config.minDeposit, max: config.maxDeposit });
  if (!parsed.ok) {
    return { text: amountRejection(parsed) };
  }

  const amount = parsed.amount;
  const orderId = generateOrderId('B');

  // No bonus: receivedAmount === amount, face value only.
  const order = await BotOrder.create({
    orderId,
    group: group._id,
    groupId: group.groupId,
    amount,
    receivedAmount: amount,
    currency: 'INR',
    network: 'SPAY',
    status: 'pending',
    remark: 'Group deposit via Telegram bot',
    requestedBy: ctx.from?.id ?? null,
    requestedByUsername: ctx.from?.username || '',
  });

  let apiRes;
  try {
    apiRes = await simplypay.createPaymentOrder({
      merOrderNo: orderId,
      amount,
      notifyUrl: config.botNotifyUrl,
      attach: `botdeposit_${orderId}`,
      extra: {
        name: 'Group Deposit',
        email: 'bot@subnpay',
        mobile: '9999999999',
      },
    });
  } catch (err) {
    order.status = 'failed';
    order.remark = `Gateway request error: ${err.message}`;
    await order.save();
    await alertOwner(ctx, 'gateway_request_error', config, client);
    return { text: '❌ Payment gateway is unreachable. Please try again shortly.' };
  }

  if (!apiRes || apiRes.code !== 0) {
    // Gateway text is untrusted and this reply is sent with parse_mode HTML, so
    // it must be escaped or a stray '<' makes Telegram reject the whole message.
    const errMsg = apiRes?.msg || apiRes?.error || `SimplyPay error (code: ${apiRes?.code})`;
    order.status = 'failed';
    order.remark = errMsg;
    await order.save();
    await alertOwner(ctx, `gateway_error: ${errMsg}`, config, client);
    return { text: `❌ Payment gateway error: ${escapeHtml(errMsg)}` };
  }

  const deepLink = apiRes.data?.params?.deepLink || null;
  const paymentLink = apiRes.data?.params?.paymentLink || null;
  const parsedLink = parseUpiLink(deepLink, amount);

  order.upiId = parsedLink.valid ? parsedLink.upiId : null;
  order.deepLink = deepLink;
  order.paymentLink = paymentLink;
  order.simplypayOrderNo = apiRes.data?.orderNo || null;
  if (!deepLink) order.remark = 'No upi deep link; gateway web link only';
  await order.save();

  // Build the reply. UPI ID + amount come from the deep link (the requirement).
  // Telegram only accepts http(s)/tg:// in inline-button URLs, so the button is
  // built from the gateway's https paymentLink; the raw upi:// is shown as text.
  const lines = [
    '💳 Deposit Requested',
    '',
    `${label('Order ID')}   : ${orderId}`,
    `${label('Group ID')}   : ${group.groupId}`,
    `${label('Amount')}     : ${formatInr(amount)}`,
  ];

  if (parsedLink.valid) {
    lines.push(`${label('UPI ID')}     : ${escapeHtml(parsedLink.upiId)}`);
    lines.push(`${label('UPI Amount')} : ${formatInr(parsedLink.upiAmount ?? amount)}`);
  } else {
    lines.push(`${label('UPI ID')}     : unavailable`);
    lines.push('');
    lines.push('UPI ID could not be parsed — use the payment link below.');
  }

  if (parsedLink.txnRef) lines.push(`${label('Gateway Ref')} : ${escapeHtml(parsedLink.txnRef)}`);
  else if (order.simplypayOrderNo) lines.push(`${label('Gateway Ref')} : ${escapeHtml(order.simplypayOrderNo)}`);

  lines.push(`${label('Status')}     : pending`);

  if (deepLink) {
    // The deep link is gateway-controlled and this message is HTML-parsed.
    lines.push('');
    lines.push(`<code>${escapeHtml(deepLink)}</code>`);
  }

  const replyOptions = { parse_mode: 'HTML' };

  // Prefer an https button (deep link only if it happens to be http, else paymentLink)
  const buttonUrl = canBeButtonUrl(deepLink) ? deepLink : canBeButtonUrl(paymentLink) ? paymentLink : null;
  if (buttonUrl) {
    replyOptions.reply_markup = {
      inline_keyboard: [[{ text: '📲 Pay now', url: buttonUrl }]],
    };
  }

  logger.info({ groupId: group.groupId, orderId, amount, upiId: order.upiId }, 'bot: /deposit created');
  return { text: lines.join('\n'), options: replyOptions };
}

module.exports = { cmdDeposit, parseDepositAmount };
