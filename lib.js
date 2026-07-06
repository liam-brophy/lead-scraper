const crypto = require('crypto');

// Stable dedup key for leads that have no natural id like Google's place_id.
function hashSourceId(...parts) {
  return crypto
    .createHash('sha1')
    .update(parts.filter(Boolean).join('|').toLowerCase().trim())
    .digest('hex');
}

// Thrown by scraper fetch helpers when a target site 403s/429s or otherwise signals
// it's blocking automated requests. Recipes can also throw this directly when they
// detect a soft block (e.g. a JS-only shell) that didn't come back as an HTTP error.
class BlockedError extends Error {}

// Deterministic day-based rotation through a list -- e.g. picking which 3 of
// 16 local categories or which literary recipe runs today. Pure function of
// (date, list) so it's trivially testable and doesn't need any stored index
// that could drift or get lost across restarts.
function dayNumber(date = new Date()) {
  return Math.floor(date.getTime() / 86400000);
}

function pickRotation(list, count, date = new Date()) {
  if (list.length === 0) return [];
  const start = (dayNumber(date) * count) % list.length;
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(list[(start + i) % list.length]);
  }
  return picked;
}

module.exports = { hashSourceId, BlockedError, dayNumber, pickRotation };
