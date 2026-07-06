// Local-business search is anchored to one fixed home base -- Philadelphia is
// not a rotating input, it's a constant. Google Places' text search for a city
// already tends to surface nearby suburbs, so one city string covers the metro
// reasonably well without multiplying category x location combinations.
const LOCAL_SEARCH_CITY = 'Philadelphia, PA';

// "Easy lifts," not "best of the best" -- ordinary small service businesses
// that exist in every town and commonly run on an old DIY site. Deliberately
// broad and unglamorous; this is not a curated top-tier prospect list.
const LOCAL_CATEGORIES = [
  'restaurant',
  'dentist',
  'therapist',
  'hair salon',
  'barber shop',
  'chiropractor',
  'veterinarian',
  'accountant',
  'law firm',
  'real estate agent',
  'auto repair shop',
  'plumber',
  'electrician',
  'yoga studio',
  'optometrist',
  'bakery',
];

// How many categories the daily automated run searches -- kept small so it
// stays cheap and doesn't just re-confirm the same businesses every day.
const DAILY_CATEGORY_COUNT = 3;

// Directory recipes worth scheduling automatically. small-press-distribution
// is excluded on purpose -- it's permanently blocked (see its recipe file),
// so scheduling it would just waste a run.
const LITERARY_RECIPES = ['clmp', 'poets-writers'];

// A lead worth surfacing as a "prime target" on the status report: scored,
// not already dead, and not already sitting in the library queue.
const PRIME_TARGET_MIN_SCORE = 50;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  LOCAL_SEARCH_CITY,
  LOCAL_CATEGORIES,
  DAILY_CATEGORY_COUNT,
  LITERARY_RECIPES,
  PRIME_TARGET_MIN_SCORE,
  ONE_DAY_MS,
};
