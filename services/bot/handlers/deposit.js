const BotOrder = require('../../../models/BotOrder');
const simplypay = require('../../simplypay');
const { generateOrderId } = require('../../../utils/helpers');
const { parseUpiLink } = require('../upilink');
const { formatInr, formatAmount, formatExpiryIst, escapeHtml } = require('../format');
const { alertOwner } = require('../guard');
const logger = require('../../../utils/logger');

// Every deposit order is shown as expiring 20 minutes after it was created.
const DEPOSIT_EXPIRY_MINUTES = 20;

// Shown by editing the original deposit slip once the 20-minute window passes.
// This is a message update only: the order keeps its real status and a late
// gateway payment can still credit it.
const EXPIRED_NOTICE_TEXT = '⚠️ order expired create new for further payment';

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
      return 'Usage: /deposit <amount>\nExample: /deposit 400';
    case 'below_min':
      return `Minimum deposit is ${formatInr(parsed.min)}.`;
    case 'above_max':
      return `Maximum deposit is ${formatInr(parsed.max)}.`;
    default:
      return 'Invalid amount. Use a plain number, e.g. /deposit 400';
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
    return { text: 'Payment gateway is unreachable. Please try again shortly.' };
  }

  if (!apiRes || apiRes.code !== 0) {
    // Plain-text reply (no parse_mode), so the gateway message is shown as-is.
    const errMsg = apiRes?.msg || apiRes?.error || `SimplyPay error (code: ${apiRes?.code})`;
    order.status = 'failed';
    order.remark = errMsg;
    await order.save();
    await alertOwner(ctx, `gateway_error: ${errMsg}`, config, client);
    return { text: `Payment gateway error: ${errMsg}` };
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

  // Show the amount carried by the gateway deep link (`am`), because that is the
  // figure the UPI app will prefill. Fall back to the requested amount only when
  // the link has no usable `am`.
  const payAmount = parsedLink.upiAmount ?? amount;
  const expiresAt = new Date(new Date(order.createdAt).getTime() + DEPOSIT_EXPIRY_MINUTES * 60 * 1000);
  const reply = buildDepositReply({
    orderId,
    amount: payAmount,
    upiId: parsedLink.valid ? parsedLink.upiId : null,
    expiresAt,
  });

  logger.info({ groupId: group.groupId, orderId, amount, upiId: order.upiId }, 'bot: /deposit created');
  return { ...reply, orderId, expiresAt };
}

/**
 * The /deposit reply: order id, amount to pay, UPI id, expiry and a warning.
 * `amount` is the deep-link amount (what the UPI app prefills), not necessarily
 * the amount typed after /deposit. Amount and UPI id get copy buttons; the order
 * id is only rendered as <code> (tap to copy).
 *
 * @returns {{ text: string, options: object }}
 */
function buildDepositReply({ orderId, amount, upiId, expiresAt }) {
  const expiry =
    expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())
      ? expiresAt
      : new Date(Date.now() + DEPOSIT_EXPIRY_MINUTES * 60 * 1000);

  const text = [
    `Order ID: <code>${escapeHtml(orderId)}</code>`,
    `Amount to pay: ${formatInr(amount)}`,
    `UPI ID: ${upiId ? `<code>${escapeHtml(upiId)}</code>` : 'unavailable'}`,
    `Expires at: ${formatExpiryIst(expiry)} [${DEPOSIT_EXPIRY_MINUTES} minutes]`,
    '',
    '⚠️ Do not use the same order for multiple payments.',
  ].join('\n');

  const keyboard = [
    [{ text: 'Copy amount', copy_text: { text: formatAmount(amount).replace(/,/g, '') } }],
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

/**
 * Best-effort: edit the original deposit slip once its 20-minute window passes.
 * The order is only read (never written), so its real status is untouched and a
 * late payment can still be credited by the gateway webhook. If the process
 * restarts before the timer fires the slip simply stays as it was.
 */
function scheduleDepositExpiryEdit({ client, chatId, message, orderId, expiresAt }) {
  const messageId = message?.message_id;
  const dueAt = expiresAt instanceof Date ? expiresAt.getTime() : NaN;
  if (!client || messageId == null || Number.isNaN(dueAt)) return null;

  const timer = setTimeout(async () => {
    try {
      const order = await BotOrder.findOne({ orderId }).select('status').lean();
      if (!order || order.status !== 'pending') return;

      await client.editMessageText(EXPIRED_NOTICE_TEXT, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch (err) {
      logger.warn({ err, orderId }, 'bot: failed to mark deposit slip expired');
    }
  }, Math.max(0, dueAt - Date.now()));

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  cmdDeposit,
  parseDepositAmount,
  buildDepositReply,
  scheduleDepositExpiryEdit,
  DEPOSIT_EXPIRY_MINUTES,
  EXPIRED_NOTICE_TEXT,
};

