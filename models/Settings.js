const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    telegramSupportUrl: {
      type: String,
      default: '',
      trim: true,
    },
    telegramChannelUrl: {
      type: String,
      default: '',
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Settings', settingsSchema);