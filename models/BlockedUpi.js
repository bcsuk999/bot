const mongoose = require('mongoose');

const blockedUpiSchema = new mongoose.Schema(
  {
    upiId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    createdBy: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlockedUpi', blockedUpiSchema);
