const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; LeadPipelineBot/1.0; +https://available.liam.site)';
const FETCH_TIMEOUT_MS = 10000;
const STALE_YEAR_GAP = 2;

// WordPress scores as high as Wix/Squarespace/Weebly now, not below them --
// plugin/core vulnerabilities and upkeep burden make an aging WP site a real
// migrate-to-something-modern pitch, not a "probably fine" case.
const BUILDER_SCORE = { wix: 15, squarespace: 15, weebly: 15, wordpress: 20 };

// Pure scoring function: higher score = better prospect (their site shows more
// signs of needing a rebuild). Kept separate from the fetch logic so it's trivially unit-testable.
//
// Deliberately scores only things a full rebuild actually fixes -- no signal
// for slow response time, since site-speed tuning isn't the service being sold
// here (still recorded in signals.responseTimeMs for reference, just not scored).
function scoreSite(signals = {}) {
  let score = 0;

  if (signals.hasSSL === false) score += 20;
  if (signals.mobileFriendly === false) score += 25;
  if (signals.builder && BUILDER_SCORE[signals.builder]) score += BUILDER_SCORE[signals.builder];
  if (signals.staleCopyrightYear) score += 20;
  if (signals.fetchFailed || signals.blocked) score += 10;

  return Math.max(0, Math.min(100, score));
}

function detectBuilder(html) {
  const lower = html.toLowerCase();
  if (lower.includes('wix.com') || lower.includes('wixstatic.com')) return 'wix';
  if (lower.includes('squarespace.com') || lower.includes('static1.squarespace')) return 'squarespace';
  if (lower.includes('weebly.com') || lower.includes('weeblycloud.com')) return 'weebly';
  if (lower.includes('wp-content') || lower.includes('wp-includes')) return 'wordpress';
  return null;
}

function extractCopyrightYear(text) {
  const match = text.match(/(?:©|copyright)\D{0,10}((?:19|20)\d{2})/i);
  return match ? Number(match[1]) : null;
}

async function analyzeSite(url) {
  const signals = { hasSSL: url.startsWith('https://') };
  const start = Date.now();

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    signals.responseTimeMs = Date.now() - start;
    signals.httpStatus = res.status;

    if (res.status === 403 || res.status === 429) {
      signals.blocked = true;
      return { signals, fitScore: scoreSite(signals) };
    }
    if (!res.ok) {
      signals.fetchFailed = true;
      return { signals, fitScore: scoreSite(signals) };
    }

    signals.hasSSL = res.url.startsWith('https://');

    const html = await res.text();
    const $ = cheerio.load(html);

    signals.mobileFriendly = $('meta[name="viewport"]').length > 0;
    signals.builder = detectBuilder(html);

    const bodyText = $('body').text();
    const year = extractCopyrightYear(bodyText) ?? extractCopyrightYear(html);
    signals.copyrightYear = year;
    signals.staleCopyrightYear = year !== null && new Date().getFullYear() - year >= STALE_YEAR_GAP;
  } catch (err) {
    signals.fetchFailed = true;
    signals.error = err.message;
  }

  return { signals, fitScore: scoreSite(signals) };
}

module.exports = { analyzeSite, scoreSite, detectBuilder, extractCopyrightYear };
