const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema(
  {
    payoutId: {
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
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    bankName: {
      type: String,
      required: true,
    },
    holderName: {
      type: String,
      required: true,
    },
    accountNumber: {
      type: String,
      required: true,
    },
    ifsc: {
      type: String,
      required: true,
    },
    trnId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    remark: {
      type: String,
      default: '',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
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

payoutSchema.index({ user: 1, status: 1 });
payoutSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Payout', payoutSchema);
