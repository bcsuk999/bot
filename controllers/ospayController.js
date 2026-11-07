const ospay = require('../services/ospay');
const botWebhookController = require('./botWebhookController');
const logger = require('../utils/logger');

/**
 * OSPAY asynchronous callback.
 *
 * The gateway posts form-urlencoded fields and expects the literal string `ok`
 * back. Anything else is treated as a failed notification and retried.
 * Signature failures return `fail` so a legitimate callback can retry once the
 * configuration is fixed.
 */
async function botCallback(req, res, settle = botWebhookController.settleOspayOrder) {
  try {
    const body = req.body || {};

    logger.info(
      {
        merId: body.mer_id,
        orderId: body.order_id,
        status: body.status,
        amount: body.amount,
        realpay: body.realpay,
        remark: body.remark,
        contentType: req.headers?.['content-type'],
        ip: req.ip,
      },
      'OSPAY webhook received'
    );

    if (!ospay.verifySign(body)) {
      logger.warn(
        { orderId: body.order_id, status: body.status, sign: body.sign },
        'OSPAY callback signature mismatch'
      );
      return res.status(400).type('text/plain').send('fail');
    }

    logger.info({ orderId: body.order_id, status: body.status }, 'OSPAY callback signature verified');

    if (!body.order_id) {
      logger.warn('OSPAY callback missing order_id');
      return res.status(400).type('text/plain').send('fail');
    }

    const result = await settle(body.order_id, body.status);
    logger.info(
      { orderId: body.order_id, status: body.status, action: result.action, trnId: result.trnId, balance: result.balance },
      'OSPAY callback handled'
    );
    return res.status(200).type('text/plain').send('ok');
  } catch (err) {
    logger.error({ err, orderId: req.body?.order_id }, 'OSPAY callback error');
    return res.status(500).type('text/plain').send('fail');
  }
}

module.exports = { botCallback };
