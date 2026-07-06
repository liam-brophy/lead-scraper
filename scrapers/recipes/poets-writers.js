const cheerio = require('cheerio');

const LISTING_URL = 'https://www.pw.org/small_presses';
// Drupal Views pager, plain ?page=N query param (0-indexed), confirmed live 2026-07-06.
// The full directory runs to ~12 pages (~450 presses); default to a couple of pages
// per run to keep each scrape to a reviewable batch and avoid hammering the site --
// bump MAX_PAGES if a bigger pull is wanted.
const MAX_PAGES = 2;

function absolute(href) {
  if (!href) return null;
  return href.startsWith('http') ? href : `https://www.pw.org${href}`;
}

async function scrapeProfile(fetchPage, path) {
  const html = await fetchPage(absolute(path));
  const $ = cheerio.load(html);

  return {
    site_url: $('.field-name-field-website a').first().attr('href') || null,
    city: $('.field-name-field-city .field-item').first().text().trim() || null,
    category: $('.field-name-field-genres .field-item').first().text().trim() || null,
  };
}

async function scrape({ fetchPage }) {
  const leads = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchPage(`${LISTING_URL}?page=${page}`);
    const $ = cheerio.load(html);

    const entries = [];
    $('.views-field-title h2 a').each((_, el) => {
      const name = $(el).text().trim();
      const href = $(el).attr('href');
      if (name && href) entries.push({ name, href });
    });

    if (entries.length === 0) break; // ran past the last page

    for (const entry of entries) {
      try {
        const details = await scrapeProfile(fetchPage, entry.href);
        leads.push({ name: entry.name, ...details });
      } catch {
        leads.push({ name: entry.name, site_url: null, category: null, city: null });
      }
    }
  }

  return leads;
}

module.exports = { category: 'literary-publisher', scrape };
