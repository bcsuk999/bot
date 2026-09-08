const BonusConfig = require('../models/BonusConfig');
const Settings = require('../models/Settings');
const CommissionConfig = require('../models/CommissionConfig');
const { getCached, clearCache } = require('../utils/cache');
const { resolveRate } = require('../controllers/payinExchangeController');

const TTL_MS = 60 * 1000;

function getExchangeRate() {
  return getCached('exchangeRate', TTL_MS, () => resolveRate());
}

async function getInrBonus() {
  return getCached('inrBonus', TTL_MS, async () => {
    let config = await BonusConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config) {
      config = { bonusPercentage: 0, bonusFlat: 0, isActive: false };
    }
    return {
      bonusPercentage: config.bonusPercentage || 0,
      bonusFlat: config.bonusFlat || 0,
      isActive: config.isActive || false,
    };
  });
}

async function getCommissionConfig() {
  return getCached('commissionConfig', TTL_MS, async () => {
    let config = await CommissionConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config) {
      config = { commissionPercentage: 0, isActive: false };
    }
    return {
      commissionPercentage: config.commissionPercentage || 0,
      isActive: config.isActive || false,
    };
  });
}

async function getTelegram() {
  return getCached('telegram', TTL_MS, async () => {
    const s = await Settings.findOne().lean();
    return {
      support: s?.telegramSupportUrl || '',
      channel: s?.telegramChannelUrl || '',
    };
  });
}

function refreshExchangeRate() {
  clearCache('exchangeRate');
}

function refreshInrBonus() {
  clearCache('inrBonus');
}

function refreshCommissionConfig() {
  clearCache('commissionConfig');
}

function refreshTelegram() {
  clearCache('telegram');
}

module.exports = {
  getExchangeRate,
  getInrBonus,
  getCommissionConfig,
  getTelegram,
  refreshExchangeRate,
  refreshInrBonus,
  refreshCommissionConfig,
  refreshTelegram,
};