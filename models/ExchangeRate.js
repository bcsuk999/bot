const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['USDT'],
      default: 'USDT',
      index: true,
    },
    network: {
      type: String,
      enum: ['TRC20', 'BEP20', null],
      default: null,
      index: true,
    },
    rate: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// One active rate per currency+network (network null = global fallback)
exchangeRateSchema.index({ currency: 1, network: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('ExchangeRate', exchangeRateSchema);
