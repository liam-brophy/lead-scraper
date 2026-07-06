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

module.exports = { hashSourceId, BlockedError };
