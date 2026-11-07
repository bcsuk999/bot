const mongoose = require('mongoose');

// A group deposit order. No bonus: receivedAmount always equals amount.
// The gateway is the only thing that can expire an order - there is no
// expiresAt field, no TTL index and no auto-cancel job.
const botOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TelegramGroup',
      required: true,
      index: true,
    },
    groupId: {
      type: String,
      index: true,
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    receivedAmount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    currency: {
      type: String,
      enum: ['INR'],
      default: 'INR',
    },
    network: {
      type: String,
      default: 'SPAY',
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'expired', 'reversed'],
      default: 'pending',
      index: true,
    },
    // Which way the money moves. 'credit' for every deposit and every manual
    // credit, 'debit' only for a manual withdrawal adjustment. Deposit stats key
    // off this so money leaving the group can never inflate a deposit figure.
    // Rows written before the field existed are missing it and read as 'credit'.
    direction: {
      type: String,
      enum: ['credit', 'debit'],
      default: 'credit',
    },
    // `pa` parsed out of the gateway's upi:// deep link
    upiId: {
      type: String,
      default: null,
    },
    deepLink: {
      type: String,
      default: null,
    },
    paymentLink: {
      type: String,
      default: null,
    },
    simplypayOrderNo: {
      type: String,
      default: null,
      index: true,
    },
    // Gateway-side order id for non-SimplyPay gateways (currently OSPAY's
    // `order_code`). Kept separate so existing SimplyPay rows are untouched.
    gatewayOrderNo: {
      type: String,
      default: null,
      index: true,
    },
    // Set once the order is credited - links to the BotTransaction row
    trnId: {
      type: String,
      default: null,
      index: true,
    },
    // Telegram message id of the /d slip. Lets a settled order edit that
    // slip in place (completed / expired) instead of only posting a new message.
    messageId: {
      type: Number,
      default: null,
    },
    // Amount printed on the /d slip. The gateway deep link can carry a
    // different `am`, so this is kept to rebuild the exact slip later.
    slipAmount: {
      type: Number,
      default: null,
    },
    // AUDIT ONLY - who typed /d. Never used for wallet lookup or authorization.
    requestedBy: {
      type: Number,
      default: null,
    },
    requestedByUsername: {
      type: String,
      default: '',
    },
    remark: {
      type: String,
      default: '',
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

botOrderSchema.index({ group: 1, status: 1 });
botOrderSchema.index({ group: 1, createdAt: -1 });
botOrderSchema.index({ groupId: 1, createdAt: -1 });
botOrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BotOrder', botOrderSchema);
