const bcrypt = require('bcrypt');
const User = require('../models/User');
const logger = require('../utils/logger');

const SALT_ROUNDS = 10;
const MIN_LEN = 6;
const MAX_LEN = 72; // bcrypt limit

function validateNewPassword(oldPassword, newPassword) {
  if (!newPassword || !String(newPassword).trim()) {
    return 'New password is required';
  }
  const trimmed = String(newPassword);
  if (trimmed.length < MIN_LEN) {
    return `New password must be at least ${MIN_LEN} characters`;
  }
  if (trimmed.length > MAX_LEN) {
    return `New password must be at most ${MAX_LEN} characters`;
  }
  if (oldPassword != null && String(oldPassword) === trimmed) {
    return 'New password must be different from old password';
  }
  return null;
}

/**
 * Change password for authenticated user (self-service).
 * Optimized: single DB fetch + bcrypt compare + single save.
 * @param {string} userId - Mongo ObjectId string from req.user.userId
 * @param {string} oldPassword - plaintext current password
 * @param {string} newPassword - plaintext new password
 * @returns {{ user: object }} on success, throws with status+msg on failure
 */
async function changeOwnPassword(userId, oldPassword, newPassword) {
  if (!oldPassword || !String(oldPassword).trim()) {
    const err = new Error('Old password is required');
    err.status = 400;
    throw err;
  }

  const validationError = validateNewPassword(oldPassword, newPassword);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  // Single fetch: need password hash, so no lean (need save later)
  const user = await User.findById(userId).select('password status');
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (user.status !== 'active') {
    const err = new Error(`Account is ${user.status}. Please contact support.`);
    err.status = 403;
    throw err;
  }

  const isMatch = await bcrypt.compare(String(oldPassword), user.password);
  if (!isMatch) {
    const err = new Error('Old password is incorrect');
    err.status = 400;
    throw err;
  }

  const hashed = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
  user.password = hashed;
  await user.save();

  logger.info({ userId }, 'Password changed successfully');
  return { userId: user._id };
}

/**
 * Admin reset any user's password by userid (numeric) without old password.
 * For support use-case.
 */
async function adminResetUserPassword(targetUserid, newPassword) {
  const validationError = validateNewPassword(null, newPassword);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const user = await User.findOne({ userid: Number(targetUserid) }).select('password');
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const hashed = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
  user.password = hashed;
  await user.save();

  logger.info({ targetUserid }, 'Admin reset user password');
  return { userId: user._id, userid: targetUserid };
}

module.exports = {
  validateNewPassword,
  changeOwnPassword,
  adminResetUserPassword,
  SALT_ROUNDS,
};
