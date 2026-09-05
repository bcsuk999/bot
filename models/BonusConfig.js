const mongoose = require('mongoose');

const bonusConfigSchema = new mongoose.Schema(
  {
    bonusPercentage: {
      type: Number,
      default: 0,
      min: 0,
    },
    bonusFlat: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
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

module.exports = mongoose.model('BonusConfig', bonusConfigSchema);
