const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  userid: {
    type: Number,
    index: true
  },
  bankName: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  holderName: {
    type: String,
    required: true,
    trim: true
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  ifsc: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  status: {
    type: String,
    enum: ['enable', 'disable'],
    default: 'enable',
    index: true
  }
}, { timestamps: true });

// Compound / query-optimized indexes
bankSchema.index({ user: 1, status: 1, createdAt: -1 });
bankSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Bank', bankSchema);
