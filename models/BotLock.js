const mongoose = require('mongoose');

// A short-lived lease shared by every backend replica. Telegram allows only one
// getUpdates consumer per bot token, so only the replica that owns this row may
// run the polling loop. The lease expires automatically if a process dies.
const botLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    owner: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BotLock', botLockSchema);
