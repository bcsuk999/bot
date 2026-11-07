const mongoose = require('mongoose');
const simplypay = require('../services/simplypay');
const botGroupService = require('../services/botGroupService');
const BotOrder = require('../models/BotOrder');
const TelegramGroup = require('../models/TelegramGroup');
const { getClient, getConfig } = require('../services/bot/client');
const { formatAmount, formatInr } = require('../services/bot/format');
const { buildDepositReply, DEPOSIT_EXPIRY_MINUTES } = require('../services/bot/handlers/deposit');
const logger = require('../utils/logger');

// SimplyPay status codes. The gateway is the only thing that can expire an order.
// EXPIRED_STATUSES is intentionally empty by default: the local API doc lists
// 0, 1 and -4 as pending and documents no expired code, so guessing one would
// mark a live payment expired and never credit it. Configure the real code with
// SIMPLYPAY_EXPIRED_STATUSES once confirmed with the gateway.
const SUCCESS_STATUSES = [2, 3];
const FAILED_STATUSES = [-1, -2];
const EXPIRED_STATUSES = [];

function expiredStatuses() {
  const configured = getConfig()?.expiredStatuses;
  return Array.isArray(configured) ? configured : EXPIRED_STATUSES;
}

async function notifyGroup(groupId, text) {
  const client = getClient();
  if (!client) {
    logger.warn({ groupId }, 'bot: no client, skipped group notification');
    return;
  }
  try {
    await client.sendMessage(groupId, text);
  } catch (err) {
    // Never throw into the webhook - it must still return 200.
    logger.error({ err, groupId }, 'bot: failed to post group notification');
  }
}

// Group notification for a settled deposit: a completed-order slip. The group
// balance is deliberately left out - the member reads it back with /balance.
//
// `direction` comes from the BotOrder: gateway deposits and manual credits are
// 'credit' (payin), while a manual withdrawal adjustment is 'debit' (payout).
// The type line makes the two indistinguishable-looking slips tell apart.
function buildSuccessNotice({ orderId, amount, direction }) {
  const type = direction === 'debit' ? 'PAYOUT🔺' : 'PAYIN🔻';
  return [
    'Order completed 💕',
    '',
    'Order type: Payment Order',
    `type: ${type}`,
    `Order No: ${orderId}`,
    'Status: Completed✅',
    `Amount: ${formatAmount(amount)}`,
  ].join('\n');
}

function buildFailedNotice({ orderId, amount, reason }) {
  return [
    'Deposit failed',
    '',
    `Order ID: ${orderId}`,
    `Amount: ${formatInr(amount)}`,
    `Reason: ${reason}`,
  ].join('\n');
}

async function notifySuccess(order, credited) {
  await notifyGroup(
    order.groupId,
    buildSuccessNotice({ orderId: order.orderId, amount: credited, direction: order.direction })
  );

  await markDepositSlipCompleted(order, credited);
}

/**
 * Edit the original /d slip in place so it reads "order completed" instead
 * of leaving the pending slip in the group. Message only - the order is already
 * settled by the time this runs, and an edit failure never affects settlement.
 */
async function markDepositSlipCompleted(order, credited) {
  if (order?.messageId == null) return;

  const client = getClient();
  if (!client) return;

  try {
    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const expiresAt =
      createdAt && !Number.isNaN(createdAt.getTime())
        ? new Date(createdAt.getTime() + DEPOSIT_EXPIRY_MINUTES * 60 * 1000)
        : undefined;

    const slip = buildDepositReply({
      orderId: order.orderId,
      amount: order.slipAmount ?? credited,
      upiId: order.upiId || null,
      expiresAt,
      completed: true,
      payUrl: order.paymentLink || null,
      copyAmount: order.slipAmount ?? credited,
    });

    await client.editMessageText(slip.text, {
      chat_id: order.groupId,
      message_id: order.messageId,
      ...slip.options,
    });
  } catch (err) {
    logger.warn({ err, orderId: order.orderId }, 'bot: failed to mark deposit slip completed');
  }
}

async function notifyFailed(order, reason) {
  await notifyGroup(
    order.groupId,
    buildFailedNotice({ orderId: order.orderId, amount: order.amount, reason })
  );
}

/**
 * Atomically claim a pending order. Returns the order doc on success, or null if
 * it was already handled (double-webhook guard). Must be called before crediting.
 */
async function claimOrder(orderId, set, session) {
  const q = BotOrder.findOneAndUpdate({ orderId, status: 'pending' }, { $set: set }, { returnDocument: 'after' });
  if (session) q.session(session);
  return q;
}

/**
 * Atomically claim a pending order and credit the group ledger, in ONE
 * transaction.
 *
 * Claiming the order and writing the ledger must be atomic: if they were two
 * separate writes, a crash (or a DB error) in between would leave the order
 * marked success while the member was never actually credited, and every later
 * gateway retry would be rejected as "already success". Money would be lost with
 * no way to recover automatically.
 *
 * The group document is also written inside the transaction. That is what makes
 * two concurrent credits for the same group conflict and retry, instead of both
 * reading the same balance and writing the same balanceAfter.
 *
 * Returns { action: 'credited' | 'already_*' | 'race_lost', ... }.
 * Throws only if the transaction could not be committed at all.
 */
async function settleSuccess(
  merOrderNo,
  orderStatus,
  { orderRemark, transactionRemark } = {}
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const claimed = await claimOrder(
        merOrderNo,
        {
          status: 'success',
          paidAt: new Date(),
          remark: orderRemark ?? `SimplyPay status: ${orderStatus}`,
        },
        session
      );
      if (!claimed) {
        result = { action: 'race_lost' };
        return;
      }

      const { transaction, credited, balance } = await botGroupService.creditGroup(claimed, {
        remark: transactionRemark ?? `Group deposit ${claimed.orderId}`,
        session,
      });
      await BotOrder.updateOne({ _id: claimed._id }, { $set: { trnId: transaction.trnId } }, { session });

      result = { action: 'credited', order: claimed, credited, balance, trnId: transaction.trnId };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Apply a gateway status to a bot order. Shared by both webhook endpoints.
 *
 * The gateway does not always honour the per-order notifyUrl, so a group
 * deposit callback can land on the plain payin endpoint
 * (/webhook/simplypay/payin) instead of /webhook/simplypay/bot. That endpoint
 * looks the id up as a Payin, finds nothing and returns 200 - silently dropping
 * the payment and leaving the BotOrder pending forever. Callers that have
 * already verified the signature therefore route unmatched ids through here.
 */
async function settleBotOrder(merOrderNo, orderStatus) {
  const peek = await BotOrder.findOne({ orderId: merOrderNo }).select('_id groupId orderId status').lean();
  if (!peek) return { ok: true, action: 'order_not_found' };
  if (peek.status !== 'pending') return { ok: true, action: 'already_' + peek.status };

  if (SUCCESS_STATUSES.includes(orderStatus)) {
    const settled = await settleSuccess(merOrderNo, orderStatus);
    if (settled.action !== 'credited') return { ok: true, action: settled.action };
    await notifySuccess(settled.order, settled.credited);
    return { ok: true, action: 'credited', trnId: settled.trnId, balance: settled.balance };
  }

  if (expiredStatuses().includes(orderStatus)) {
    const order = await claimOrder(merOrderNo, {
      status: 'expired',
      remark: `SimplyPay status: ${orderStatus}`,
    });
    if (!order) return { ok: true, action: 'race_lost' };
    await notifyFailed(order, 'expired');
    return { ok: true, action: 'expired' };
  }

  if (FAILED_STATUSES.includes(orderStatus)) {
    const order = await claimOrder(merOrderNo, {
      status: 'failed',
      remark: `SimplyPay status: ${orderStatus}`,
    });
    if (!order) return { ok: true, action: 'race_lost' };
    await TelegramGroup.updateOne({ groupId: order.groupId }, { $inc: { totalFailed: 1 } });
    await notifyFailed(order, `status ${orderStatus}`);
    return { ok: true, action: 'failed' };
  }

  // 0, 1, and any code the gateway has not documented: still pending. No-op.
  logger.debug({ merOrderNo, orderStatus }, 'bot: callback pending, no action');
  return { ok: true, action: 'no_op' };
}

/**
 * Apply an OSPAY callback status to a bot order.
 *
 * OSPAY uses string statuses: `OK` for a successful collection and `error` for
 * a failed one. Everything else is ignored. The claim/credit path is the same
 * atomic path SimplyPay uses, so a duplicate callback cannot double-credit.
 */
async function settleOspayOrder(orderId, status) {
  const peek = await BotOrder.findOne({ orderId }).select('_id groupId orderId status').lean();
  if (!peek) return { ok: true, action: 'order_not_found' };
  if (peek.status !== 'pending') return { ok: true, action: 'already_' + peek.status };

  const normalized = String(status || '').trim().toUpperCase();

  if (normalized === 'OK') {
    const settled = await settleSuccess(orderId, 'OK', {
      orderRemark: 'OSPAY status: OK',
      transactionRemark: `Group deposit ${orderId}`,
    });
    if (settled.action !== 'credited') return { ok: true, action: settled.action };
    await notifySuccess(settled.order, settled.credited);
    return { ok: true, action: 'credited', trnId: settled.trnId, balance: settled.balance };
  }

  if (normalized === 'ERROR') {
    const order = await claimOrder(orderId, {
      status: 'failed',
      remark: 'OSPAY status: error',
    });
    if (!order) return { ok: true, action: 'race_lost' };
    await TelegramGroup.updateOne({ groupId: order.groupId }, { $inc: { totalFailed: 1 } });
    await notifyFailed(order, 'OSPAY error');
    return { ok: true, action: 'failed' };
  }

  logger.debug({ orderId, status }, 'bot: OSPAY callback status not actionable');
  return { ok: true, action: 'no_op' };
}

/**
 * Settle a SimplyPay webhook for a group deposit.
 * Always responds 200 - a non-2xx makes the gateway retry.
 */
async function handlePayinCallback(body = {}) {
  if (!simplypay.verifySign(body)) {
    logger.warn('bot: SimplyPay callback signature mismatch');
    return { ok: true, action: 'bad_signature' };
  }

  // Accept both callback shapes: flat fields or `{ data: { ... } }`.
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const { merOrderNo, orderStatus } = data;
  if (!merOrderNo) return { ok: true, action: 'no_order_no' };

  return settleBotOrder(merOrderNo, orderStatus);
}

// Express handler
async function botPayinCallback(req, res) {
  try {
    const result = await handlePayinCallback(req.body);
    logger.info({ action: result.action }, 'bot: webhook handled');
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'bot: webhook error');
    return res.status(200).json({ success: true });
  }
}

module.exports = {
  botPayinCallback,
  handlePayinCallback,
  settleBotOrder,
  settleOspayOrder,
  claimOrder,
  settleSuccess,
  buildSuccessNotice,
  buildFailedNotice,
  notifySuccess,
  SUCCESS_STATUSES,
  FAILED_STATUSES,
  EXPIRED_STATUSES,
};
