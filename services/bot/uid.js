// Public 5-digit member code for a group ("32045"). It is a human-friendly
// handle for support and the admin panel; `groupId` remains the real identity
// used for money and authorization. Pure helpers so they are unit-testable.

const UID_LENGTH = 5;
const UID_MIN = 10 ** (UID_LENGTH - 1); // 10000
const UID_MAX = 10 ** UID_LENGTH - 1; // 99999

function isValidUid(value) {
  if (value == null) return false;
  return /^\d{5}$/.test(String(value).trim());
}

/**
 * Pick a random uid in [10000, 99999]. `random` is injectable so tests can
 * pin the bounds; callers must still check the database for a collision.
 */
function randomUid(random = Math.random) {
  const span = UID_MAX - UID_MIN + 1;
  return String(Math.floor(random() * span) + UID_MIN);
}

module.exports = {
  UID_LENGTH,
  UID_MIN,
  UID_MAX,
  isValidUid,
  randomUid,
};
