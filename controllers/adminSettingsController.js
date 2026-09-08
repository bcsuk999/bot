const Settings = require('../models/Settings');
const logger = require('../utils/logger');
const { getTelegram, refreshTelegram } = require('../services/configService');

exports.getSettings = async (req, res) => {
  try {
    const telegram = await getTelegram();
    return res.json({
      success: true,
      settings: {
        telegramSupportUrl: telegram.support,
        telegramChannelUrl: telegram.channel,
      },
    });
  } catch (err) {
    logger.error({ err }, 'getSettings error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to fetch settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { telegramSupportUrl, telegramChannelUrl } = req.body;

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    if (telegramSupportUrl !== undefined) {
      settings.telegramSupportUrl = String(telegramSupportUrl).trim();
    }
    if (telegramChannelUrl !== undefined) {
      settings.telegramChannelUrl = String(telegramChannelUrl).trim();
    }

    settings.updatedBy = req.user.userId;
    await settings.save();
    refreshTelegram();

    return res.json({
      success: true,
      msg: 'Settings updated',
      settings: {
        telegramSupportUrl: settings.telegramSupportUrl,
        telegramChannelUrl: settings.telegramChannelUrl,
      },
    });
  } catch (err) {
    logger.error({ err }, 'updateSettings error');
    return res.status(500).json({ success: 'failed', msg: 'Failed to update settings' });
  }
};