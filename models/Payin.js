const mongoose = require('mongoose');

const payinSchema = new mongoose.Schema(
  {
    payinId: {
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
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['USDT'],
    },
    network: {
      type: String,
      required: true,
      enum: ['TRC20', 'BEP20'],
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    address: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'reversed'],
      default: 'pending',
      index: true,
    },
    transactionType: {
      type: String,
      enum: ['payin', 'payout'],
      required: true,
      default: 'payin',
    },
    txHash: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    confirmations: {
      type: Number,
      default: 0,
    },
    requiredConfirmations: {
      type: Number,
      default: 12,
    },
    remark: {
      type: String,
      default: '',
    },
    detectedAmount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    reversedAt: {
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

payinSchema.index({ user: 1, status: 1 });
payinSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Payin', payinSchema);
