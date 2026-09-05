const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    trnId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userid: {
      type: Number,
      index: true,
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    note: {
      type: String,
      enum: ['payin', 'payout', 'reversal'],
      required: true,
      default: 'payin',
    },
    remark: {
      type: String,
      default: '',
    },
    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'reversed'],
      default: 'pending',
      index: true,
    },
    // internal refs kept for linking with Payin, not required in user display but kept for logic
    referenceId: {
      type: String,
      default: null,
    },
    network: {
      type: String,
      enum: ['TRC20', 'BEP20', 'INR'],
      default: null,
    },
    currency: {
      type: String,
      uppercase: true,
      default: 'USDT',
    },
    txHash: {
      type: String,
      default: null,
    },
    exchangeRate: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    creditedAmount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

transactionSchema.index({ user: 1, status: 1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ referenceId: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
