const BlockedUpi = require('../models/BlockedUpi');
const logger = require('../utils/logger');

function normalizeUpi(upiId) {
  return String(upiId || '').trim().toLowerCase();
}

async function isBlocked(upiId) {
  const key = normalizeUpi(upiId);
  if (!key) return false;
  return !!(await BlockedUpi.exists({ upiId: key }));
}

async function listBlocked() {
  return BlockedUpi.find({}).sort({ createdAt: -1 }).lean();
}

async function blockUpi(upiId, { reason, createdBy } = {}) {
  const key = normalizeUpi(upiId);
  if (!key) {
    const err = new Error('upiId is required');
    err.status = 400;
    throw err;
  }
  const existing = await BlockedUpi.findOne({ upiId: key });
  if (existing) {
    if (reason !== undefined) existing.reason = String(reason || '').trim();
    await existing.save();
    logger.info({ upiId: key }, 'bot: upi already blocked, updated');
    return existing;
  }
  const doc = await BlockedUpi.create({
    upiId: key,
    reason: reason ? String(reason).trim() : '',
    createdBy: createdBy ?? null,
  });
  logger.info({ upiId: key, createdBy: createdBy ?? null }, 'bot: upi blocked');
  return doc;
}

async function unblockUpi(upiId) {
  const key = normalizeUpi(upiId);
  if (!key) {
    const err = new Error('upiId is required');
    err.status = 400;
    throw err;
  }
  const res = await BlockedUpi.deleteOne({ upiId: key });
  logger.info({ upiId: key, deleted: res.deletedCount }, 'bot: upi unblocked');
  return res.deletedCount > 0;
}

module.exports = { normalizeUpi, isBlocked, listBlocked, blockUpi, unblockUpi };
