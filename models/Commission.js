const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema(
  {
    commissionId: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referrerUserid: {
      type: Number,
      required: true,
      index: true,
    },
    refereeUserid: {
      type: Number,
      required: true,
      index: true,
    },
    payinId: {
      type: String,
      required: true,
      index: true,
    },
    depositAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      enum: ['USDT', 'INR'],
    },
    commissionPercentage: {
      type: Number,
      required: true,
    },
    commissionAmount: {
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
    creditedAt: {
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

commissionSchema.index({ referrer: 1, status: 1 });
commissionSchema.index({ referrer: 1, createdAt: -1 });
commissionSchema.index({ referee: 1, createdAt: -1 });
commissionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Commission', commissionSchema);
