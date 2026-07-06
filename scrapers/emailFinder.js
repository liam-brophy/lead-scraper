const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; LeadPipelineBot/1.0; +https://available.liam.site)';
const FETCH_TIMEOUT_MS = 8000;
const CONTACT_PATHS = ['/contact', '/contact-us', '/contact.html', '/about', '/about-us'];

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractMailto(html) {
  const $ = cheerio.load(html);
  const href = $('a[href^="mailto:"]').first().attr('href');
  if (!href) return null;
  const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
  return email || null;
}

// Checks the homepage, then a handful of common contact/about paths, for a mailto:
// link. Falls back to a pattern guess (info@domain) flagged with lower confidence.
async function findEmail(siteUrl) {
  if (!siteUrl) return { email: null, email_confidence: null };

  let domain;
  try {
    domain = new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return { email: null, email_confidence: null };
  }

  const homepageHtml = await fetchHtml(siteUrl);
  if (homepageHtml) {
    const found = extractMailto(homepageHtml);
    if (found) return { email: found, email_confidence: 'found' };
  }

  const base = siteUrl.replace(/\/$/, '');
  for (const path of CONTACT_PATHS) {
    const html = await fetchHtml(base + path);
    if (!html) continue;
    const found = extractMailto(html);
    if (found) return { email: found, email_confidence: 'found' };
  }

  return { email: `info@${domain}`, email_confidence: 'guessed' };
}

module.exports = { findEmail };
