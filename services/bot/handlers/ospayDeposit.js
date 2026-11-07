const BotOrder = require('../../../models/BotOrder');
const ospay = require('../../ospay');
const { generateOrderId } = require('../../../utils/helpers');
const { formatInr } = require('../format');
const { alertOwner } = require('../guard');
const { buildDepositReply, DEPOSIT_EXPIRY_MINUTES } = require('./deposit');
const logger = require('../../../utils/logger');

/**
 * Parse and bounds-check a raw /osd argument.
 *
 * OSPAY only accepts whole-number amounts ("do not add decimals"), so this is
 * stricter than /d: "500" is valid, "500.50" is not.
 */
function parseOspayAmount(raw, { min, max }) {
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, reason: 'usage' };
  }
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: 'integer' };
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
      return 'Usage: /osd <amount>\nExample: /osd 500';
    case 'integer':
      return 'OSPAY deposits must be a whole number, e.g. /osd 500';
    case 'below_min':
      return `Minimum deposit is ${formatInr(parsed.min)}.`;
    case 'above_max':
      return `Maximum deposit is ${formatInr(parsed.max)}.`;
    default:
      return 'Invalid amount. Use a whole number, e.g. /osd 500';
  }
}

/**
 * /osd - create an OSPAY collection order and return the same deposit slip as
 * /d. Owner-only is enforced in commands.js before this handler runs.
 *
 * The record, settlement and ledger path are identical to a SimplyPay bot
 * deposit; only `network` and the gateway call differ.
 */
async function cmdOspayDeposit(ctx) {
  const { group, args, config, client } = ctx;

  logger.info(
    {
      groupId: group.groupId,
      userId: ctx.from?.id,
      username: ctx.from?.username,
      rawAmount: args[0],
    },
    'bot: /osd requested'
  );

  if (!ospay.isConfigured()) {
    logger.warn({ groupId: group.groupId }, 'bot: /osd rejected - OSPAY not configured');
    return { text: 'OSPAY is not configured. Please contact support.' };
  }

  const parsed = parseOspayAmount(args[0], { min: config.minDeposit, max: config.maxDeposit });
  if (!parsed.ok) {
    logger.info(
      { groupId: group.groupId, rawAmount: args[0], reason: parsed.reason },
      'bot: /osd rejected - invalid amount'
    );
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
    network: 'OSPAY',
    status: 'pending',
    remark: 'Group deposit via Telegram bot (OSPAY)',
    requestedBy: ctx.from?.id ?? null,
    requestedByUsername: ctx.from?.username || '',
  });

  logger.info(
    { groupId: group.groupId, orderId, amount, orderMongoId: order._id },
    'bot: /osd order record created'
  );

  let apiRes;
  try {
    apiRes = await ospay.createPaymentOrder({
      orderId,
      amount,
      remark: `botospay_${orderId}`,
      userId: ctx.from?.id != null ? String(ctx.from.id) : undefined,
    });
  } catch (err) {
    logger.error({ groupId: group.groupId, orderId, amount, err }, 'bot: /osd gateway request failed');
    order.status = 'failed';
    order.remark = `OSPAY request error: ${err.message}`;
    await order.save();
    await alertOwner(ctx, 'gateway_request_error', config, client);
    return { text: 'OSPAY gateway is unreachable. Please try again shortly.' };
  }

  if (!apiRes || Number(apiRes.code) !== 0) {
    const errMsg = apiRes?.message || apiRes?.msg || `OSPAY error (code: ${apiRes?.code})`;
    logger.warn(
      { groupId: group.groupId, orderId, amount, code: apiRes?.code, message: errMsg },
      'bot: /osd gateway returned an error'
    );
    order.status = 'failed';
    order.remark = errMsg;
    await order.save();
    await alertOwner(ctx, `gateway_error: ${errMsg}`, config, client);
    return { text: `OSPAY gateway error: ${errMsg}` };
  }

  const paymentLink = apiRes.data || null;
  const upiId = apiRes.upi || null;

  order.upiId = upiId;
  order.paymentLink = paymentLink;
  order.gatewayOrderNo = apiRes.order_code || null;
  order.slipAmount = amount;
  await order.save();

  const expiresAt = new Date(new Date(order.createdAt).getTime() + DEPOSIT_EXPIRY_MINUTES * 60 * 1000);
  const reply = buildDepositReply({
    orderId,
    amount,
    upiId,
    expiresAt,
    payUrl: paymentLink,
    copyAmount: amount,
  });
  const expiredReply = buildDepositReply({
    orderId,
    amount,
    upiId,
    expiresAt,
    expired: true,
    payUrl: paymentLink,
    copyAmount: amount,
  });

  logger.info(
    {
      groupId: group.groupId,
      orderId,
      amount,
      upiId,
      paymentLink,
      gatewayOrderNo: order.gatewayOrderNo,
      expiresAt,
      network: 'OSPAY',
    },
    'bot: /osd deposit slip sent'
  );
  return { ...reply, orderId, expiresAt, expiredReply };
}

module.exports = {
  cmdOspayDeposit,
  parseOspayAmount,
  amountRejection,
};
