const cheerio = require('cheerio');

const LISTING_URL = 'https://www.clmp.org/readers/directory-of-publishers/';

// Verified live 2026-07-06: this page is a WordPress + FacetWP directory. FacetWP
// renders ~2,200 total publishers, but only the first unfiltered page (~24 entries)
// is present in the static HTML -- the rest load through a nonce-gated AJAX
// endpoint (wp-json/facetwp/v1/refresh) that isn't practical to script reliably
// without a browser. This recipe covers that first page's publishers plus their
// profile pages. Re-running periodically will surface a rotating slice, since CLMP
// appears to vary what's featured there.
function fieldValue($, label) {
  let value = null;
  $('.db-label').each((_, el) => {
    if ($(el).text().trim().toLowerCase() === label.toLowerCase()) {
      value = $(el).next('.db-value');
    }
  });
  return value;
}

async function scrapeProfile(fetchPage, url) {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const websiteField = fieldValue($, 'Website');
  const typeField = fieldValue($, 'Type Of Publisher');
  const addressField = fieldValue($, 'Address');

  return {
    site_url: websiteField ? websiteField.find('a').attr('href') || null : null,
    category: typeField ? typeField.text().trim() || null : null,
    city: addressField ? addressField.text().trim() || null : null,
  };
}

async function scrape({ fetchPage }) {
  const html = await fetchPage(LISTING_URL);
  const $ = cheerio.load(html);

  const entries = [];
  $('.publisher-partial h6 a').each((_, el) => {
    const name = $(el).text().trim();
    const href = $(el).attr('href');
    if (name && href) entries.push({ name, href });
  });

  const leads = [];
  for (const entry of entries) {
    try {
      const details = await scrapeProfile(fetchPage, entry.href);
      leads.push({ name: entry.name, ...details });
    } catch {
      leads.push({ name: entry.name, site_url: null, category: null, city: null });
    }
  }
  return leads;
}

module.exports = { category: 'literary-publisher', scrape };
