const mongoose = require('mongoose');

const depositAddressSchema = new mongoose.Schema(
  {
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['USDT'],
      default: 'USDT',
    },
    network: {
      type: String,
      required: true,
      enum: ['TRC20', 'BEP20'],
      index: true,
    },
    address: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one active per network+currency (partial unique)
depositAddressSchema.index(
  { currency: 1, network: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('DepositAddress', depositAddressSchema);
