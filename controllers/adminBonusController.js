const BonusConfig = require('../models/BonusConfig');
const logger = require('../utils/logger');

// Get current bonus config
exports.getBonusConfig = async (req, res) => {
  try {
    let config = await BonusConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config) {
      config = await BonusConfig.create({ bonusPercentage: 0, bonusFlat: 0, isActive: false });
      config = config.toObject();
    }
    return res.json({
      success: true,
      config: {
        bonusPercentage: config.bonusPercentage || 0,
        bonusFlat: config.bonusFlat || 0,
        isActive: config.isActive || false,
        updatedAt: config.updatedAt,
      },
    });
  } catch (err) {
    logger.error({ err }, 'getBonusConfig error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch bonus config' });
  }
};

// Update bonus config
exports.updateBonusConfig = async (req, res) => {
  try {
    const { bonusPercentage, bonusFlat, isActive } = req.body;

    let config = await BonusConfig.findOne().sort({ updatedAt: -1 });
    if (!config) {
      config = new BonusConfig();
    }

    if (bonusPercentage !== undefined) {
      const pct = Number(bonusPercentage);
      if (!isFinite(pct) || pct < 0) return res.status(400).json({ success: 'failed', msg: 'Invalid bonusPercentage' });
      config.bonusPercentage = pct;
    }

    if (bonusFlat !== undefined) {
      const flat = Number(bonusFlat);
      if (!isFinite(flat) || flat < 0) return res.status(400).json({ success: 'failed', msg: 'Invalid bonusFlat' });
      config.bonusFlat = flat;
    }

    if (isActive !== undefined) {
      config.isActive = Boolean(isActive);
    }

    config.updatedBy = req.user.userId;
    await config.save();

    return res.json({
      success: true,
      msg: 'Bonus config updated',
      config: {
        bonusPercentage: config.bonusPercentage,
        bonusFlat: config.bonusFlat,
        isActive: config.isActive,
        updatedAt: config.updatedAt,
      },
    });
  } catch (err) {
    logger.error({ err }, 'updateBonusConfig error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to update bonus config' });
  }
};

// Calculate bonus for a given amount (used by other controllers)
exports.calculateBonus = async (amount) => {
  try {
    const config = await BonusConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config || !config.isActive) return 0;

    const percentageBonus = (amount * (config.bonusPercentage || 0)) / 100;
    const flatBonus = config.bonusFlat || 0;
    const totalBonus = percentageBonus + flatBonus;

    return Math.round(totalBonus * 100) / 100;
  } catch (err) {
    return 0;
  }
};
