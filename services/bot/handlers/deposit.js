const BotOrder = require('../../../models/BotOrder');
const simplypay = require('../../simplypay');
const { generateOrderId } = require('../../../utils/helpers');
const { parseUpiLink, canBeButtonUrl } = require('../upilink');
const { formatInr, formatAmount, escapeHtml } = require('../format');
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

  const reply = buildDepositReply({ orderId, amount, upiId: parsedLink.valid ? parsedLink.upiId : null });

  // The gateway payment link is the only way a payment gets tied back to this
  // order, so it stays as an action button even though the message body carries
  // just the three payment details.
  const buttonUrl = canBeButtonUrl(deepLink) ? deepLink : canBeButtonUrl(paymentLink) ? paymentLink : null;
  if (buttonUrl) {
    reply.options.reply_markup.inline_keyboard.push([{ text: 'Pay now', url: buttonUrl }]);
  }

  logger.info({ groupId: group.groupId, orderId, amount, upiId: order.upiId }, 'bot: /deposit created');
  return reply;
}

/**
 * The /deposit reply: order id, amount to pay and UPI id, nothing else.
 * No emoji, no status line - it should read like a payment slip, not a bot.
 * Every value has an explicit copy button (Telegram copy_text), and the order
 * id / UPI id are rendered as <code> so tapping the text copies it too.
 *
 * @returns {{ text: string, options: object }}
 */
function buildDepositReply({ orderId, amount, upiId }) {
  const text = [
    `Order ID: <code>${escapeHtml(orderId)}</code>`,
    `Amount to pay: ${formatInr(amount)}`,
    `UPI ID: ${upiId ? `<code>${escapeHtml(upiId)}</code>` : 'unavailable'}`,
  ].join('\n');

  const keyboard = [
    [{ text: 'Copy order ID', copy_text: { text: String(orderId) } }],
    [{ text: 'Copy amount', copy_text: { text: formatAmount(amount) } }],
  ];
  if (upiId) keyboard.push([{ text: 'Copy UPI ID', copy_text: { text: String(upiId) } }]);

  return {
    text,
    options: {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    },
  };
}

module.exports = { cmdDeposit, parseDepositAmount, buildDepositReply };

