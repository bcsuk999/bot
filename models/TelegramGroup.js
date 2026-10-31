const mongoose = require('mongoose');

// A Telegram group IS the member. groupId is the only identity in the bot path —
// there is no userid and no per-human wallet. See prd/bot prd.md section 1.1.
const telegramGroupSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Public 5-digit member code, generated at registration (e.g. "32045").
    // Sparse so groups created before this field existed can be backfilled.
    uid: {
      type: String,
      unique: true,
      sparse: true,
      match: /^\d{5}$/,
    },
    title: {
      type: String,
      default: '',
    },
    username: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['group', 'supergroup', 'private'],
      default: 'supergroup',
    },
    status: {
      type: String,
      enum: ['active', 'banned', 'suspended'],
      default: 'active',
      index: true,
    },
    // Latest moderation decision. `remark` is mandatory on every change (see
    // setGroupStatus) and history keeps the full audit trail.
    statusRemark: {
      type: String,
      default: '',
    },
    statusUpdatedAt: {
      type: Date,
      default: null,
    },
    statusUpdatedBy: {
      type: Number,
      default: null,
    },
    statusHistory: [
      {
        status: { type: String, enum: ['active', 'banned', 'suspended'] },
        remark: { type: String, default: '' },
        changedBy: { type: Number, default: null },
        changedAt: { type: Date, default: Date.now },
      },
    ],
    // AUDIT ONLY - records who typed /reg. Never used to look up a wallet,
    // authorize a balance, join a query, or scope an aggregate.
    registeredBy: {
      type: Number,
      default: null,
    },
    registeredByUsername: {
      type: String,
      default: '',
    },
    lastActiveAt: {
      type: Date,
      default: null,
    },
    totalDeposits: {
      type: Number,
      default: 0,
    },
    totalCredited: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      get: (v) => (v ? parseFloat(v.toString()) : v),
    },
    totalFailed: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// status is already indexed via `index: true` on the field above.
telegramGroupSchema.index({ createdAt: -1 });
// Admin list default: newest groups, optionally filtered by status (ESR:
// equality on status, then the createdAt sort).
telegramGroupSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('TelegramGroup', telegramGroupSchema);
