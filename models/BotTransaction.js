const mongoose = require('mongoose');

// Group balance ledger. Balance = balanceAfter of the most recent
// status:'success' row for the group, else 0. Mirrors the existing
// Transaction pattern so there is no stored balance to drift out of sync.
const botTransactionSchema = new mongoose.Schema(
  {
    trnId: {
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
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BotOrder',
      default: null,
      index: true,
    },
    orderId: {
      type: String,
      default: null,
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
      default: 'credit',
    },
    note: {
      type: String,
      enum: ['deposit', 'adjustment', 'reversal'],
      default: 'deposit',
    },
    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    status: {
      type: String,
      enum: ['success', 'reversed'],
      default: 'success',
      index: true,
    },
    // AUDIT ONLY - admin userid who made a manual adjustment
    createdBy: {
      type: Number,
      default: null,
    },
    remark: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

botTransactionSchema.index({ group: 1, status: 1 });
botTransactionSchema.index({ group: 1, createdAt: -1 });
// Admin list: filter by the denormalised group id, sort by newest first.
botTransactionSchema.index({ groupId: 1, createdAt: -1 });
// Admin list: moderation/audit views filtered by status across all groups.
botTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BotTransaction', botTransactionSchema);
