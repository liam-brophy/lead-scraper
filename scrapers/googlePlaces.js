const API_BASE = 'https://maps.googleapis.com/maps/api/place';
const DEFAULT_MAX_PAGES = 3; // Text Search hard-caps at 60 results (3 pages of 20) regardless of this setting
const RETRYABLE_STATUSES = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);
const MAX_RETRIES = 4;
const NEXT_PAGE_TOKEN_DELAY_MS = 2000; // Google rejects a pagetoken used too soon after the previous page

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set. See .env.example.');
  return key;
}

async function requestWithRetry(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    const data = await res.json();
    if (!RETRYABLE_STATUSES.has(data.status) || attempt === MAX_RETRIES) return data;

    const backoff = 500 * 2 ** attempt + Math.random() * 250;
    await sleep(backoff);
  }
}

async function textSearch(query, { maxPages = DEFAULT_MAX_PAGES } = {}) {
  const key = apiKey();
  const results = [];
  let pageToken = null;
  let page = 0;

  do {
    const url = new URL(`${API_BASE}/textsearch/json`);
    url.searchParams.set('key', key);
    if (pageToken) {
      url.searchParams.set('pagetoken', pageToken);
      await sleep(NEXT_PAGE_TOKEN_DELAY_MS);
    } else {
      url.searchParams.set('query', query);
    }

    const data = await requestWithRetry(url.toString());
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Places Text Search failed: ${data.status} ${data.error_message || ''}`.trim());
    }

    results.push(...(data.results || []));
    pageToken = data.next_page_token || null;
    page += 1;
  } while (pageToken && page < maxPages);

  return results;
}

async function getDetails(placeId) {
  const url = new URL(`${API_BASE}/details/json`);
  url.searchParams.set('key', apiKey());
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,formatted_phone_number,website,formatted_address,types');

  const data = await requestWithRetry(url.toString());
  if (data.status !== 'OK') return null;
  return data.result;
}

// query: e.g. "bakery", city: "Providence, RI" -> combined into a Text Search query.
async function scrapeLocal({ query, city, maxPages }) {
  if (!query) throw new Error('scrapeLocal requires a query, e.g. "bakery"');

  const searchQuery = city ? `${query} in ${city}` : query;
  const places = await textSearch(searchQuery, { maxPages });

  const leads = [];
  for (const place of places) {
    const details = await getDetails(place.place_id);
    leads.push({
      name: details?.name || place.name,
      category: (place.types || [])[0] || null,
      source: 'google_places',
      source_id: place.place_id,
      city: city || null,
      site_url: details?.website || null,
      phone: details?.formatted_phone_number || null,
    });
  }
  return leads;
}

module.exports = { scrapeLocal, textSearch, getDetails };
