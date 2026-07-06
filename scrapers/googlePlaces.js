// Uses Places API (New) -- the classic maps.googleapis.com/maps/api/place
// endpoints are being phased out and rejected the key used in production here
// with "You're calling a legacy API, which is not enabled for your project."
// The New API's searchText already returns website/phone in one call given
// the right field mask, so there's no separate per-result Details call needed
// like the old two-step search-then-details flow required.
const API_BASE = 'https://places.googleapis.com/v1';
const DEFAULT_MAX_PAGES = 3; // ~60 results at up to 20/page, matching the old cap
const RETRYABLE_STATUSES = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']);
const MAX_RETRIES = 4;
const NEXT_PAGE_TOKEN_DELAY_MS = 2000; // Google rejects a pageToken used too soon after the previous page
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.primaryType',
  'nextPageToken',
].join(',');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set. See .env.example.');
  return key;
}

async function searchTextPage(textQuery, pageToken) {
  const body = pageToken ? { textQuery, pageToken } : { textQuery };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${API_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey(),
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) return data;

    const status = data.error?.status;
    if (!RETRYABLE_STATUSES.has(status) || attempt === MAX_RETRIES) {
      throw new Error(`Places Text Search failed: ${status || res.status} ${data.error?.message || ''}`.trim());
    }
    const backoff = 500 * 2 ** attempt + Math.random() * 250;
    await sleep(backoff);
  }
}

async function textSearch(query, { maxPages = DEFAULT_MAX_PAGES } = {}) {
  const results = [];
  let pageToken = null;
  let page = 0;

  do {
    if (pageToken) await sleep(NEXT_PAGE_TOKEN_DELAY_MS);
    const data = await searchTextPage(query, pageToken);
    results.push(...(data.places || []));
    pageToken = data.nextPageToken || null;
    page += 1;
  } while (pageToken && page < maxPages);

  return results;
}

// query: e.g. "bakery", city: "Philadelphia, PA" -> combined into a Text Search query.
async function scrapeLocal({ query, city, maxPages }) {
  if (!query) throw new Error('scrapeLocal requires a query, e.g. "bakery"');

  const searchQuery = city ? `${query} in ${city}` : query;
  const places = await textSearch(searchQuery, { maxPages });

  return places.map((place) => ({
    name: place.displayName?.text || 'Unknown',
    category: place.primaryType || null,
    source: 'google_places',
    source_id: place.id,
    city: city || null,
    site_url: place.websiteUri || null,
    phone: place.nationalPhoneNumber || null,
  }));
}

module.exports = { scrapeLocal, textSearch };
