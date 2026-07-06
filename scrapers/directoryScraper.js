const { hashSourceId, BlockedError } = require('../lib');

// Recipe contract (see recipes/*.js): a module exporting
//   category: string (default category applied to leads from this source)
//   async scrape({ fetchPage, loadPage }) -> [{ name, site_url?, city?, category?, phone? }]
// Recipes do their own page-to-page navigation since directory sites vary too much
// (pagination styles, alphabetical browse pages, profile-link follow-throughs) to
// force into one declarative selector schema.
const recipes = {
  clmp: require('./recipes/clmp'),
  'poets-writers': require('./recipes/poets-writers'),
  'small-press-distribution': require('./recipes/small-press-distribution'),
};

const USER_AGENT = 'Mozilla/5.0 (compatible; LeadPipelineBot/1.0; +https://available.liam.site)';
const FETCH_TIMEOUT_MS = 10000;
const POLITENESS_DELAY_MS = 200; // recipes often follow-through to dozens of profile pages; pace requests

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url) {
  await sleep(POLITENESS_DELAY_MS);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new BlockedError(`Blocked (${res.status}) fetching ${url}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

function listRecipes() {
  return Object.keys(recipes);
}

// Returns { leads, blocked, reason }. Never throws on a scraper being blocked --
// that's a normal outcome (skip-and-flag), not a bug. Throws for programmer errors
// (unknown recipe) or unexpected non-block HTTP failures.
async function scrapeDirectory(recipeName) {
  const recipe = recipes[recipeName];
  if (!recipe) {
    throw new Error(`Unknown directory recipe "${recipeName}". Known recipes: ${listRecipes().join(', ')}`);
  }

  try {
    const rawLeads = await recipe.scrape({ fetchPage });
    const leads = rawLeads
      .filter((lead) => lead && lead.name)
      .map((lead) => ({
        name: lead.name.trim(),
        category: lead.category || recipe.category || null,
        source: `directory:${recipeName}`,
        source_id: hashSourceId(lead.name, lead.site_url),
        city: lead.city || null,
        site_url: lead.site_url || null,
        phone: lead.phone || null,
      }));
    return { leads, blocked: false };
  } catch (err) {
    if (err instanceof BlockedError) {
      return { leads: [], blocked: true, reason: err.message };
    }
    throw err;
  }
}

module.exports = { scrapeDirectory, listRecipes };
