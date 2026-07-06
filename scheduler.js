const pLimit = require('p-limit');
const db = require('./db');
const googlePlaces = require('./scrapers/googlePlaces');
const directoryScraper = require('./scrapers/directoryScraper');
const { enrichLead } = require('./enrich');
const { pickRotation } = require('./lib');
const {
  LOCAL_SEARCH_CITY,
  LOCAL_CATEGORIES,
  DAILY_CATEGORY_COUNT,
  LITERARY_RECIPES,
  ONE_DAY_MS,
} = require('./config');

// Scrapes today's rotation of local categories + one literary recipe, then
// enriches whatever's pending. Runs once a day with no human involvement --
// by the time anyone opens the dashboard, prime targets should already be
// scored and waiting.
async function runDailyPipeline() {
  const categories = pickRotation(LOCAL_CATEGORIES, DAILY_CATEGORY_COUNT);
  const recipe = pickRotation(LITERARY_RECIPES, 1)[0];

  const run = await db.createPipelineRun({ local_categories: categories, literary_recipe: recipe });

  let localCount = 0;
  let literaryCount = 0;
  let literaryBlocked = false;
  let enrichedCount = 0;

  try {
    for (const category of categories) {
      try {
        const leads = await googlePlaces.scrapeLocal({ query: category, city: LOCAL_SEARCH_CITY });
        for (const lead of leads) await db.upsertLead(lead);
        localCount += leads.length;
      } catch (err) {
        console.error(`[scheduler] local scrape failed for "${category}":`, err.message);
      }
    }

    if (recipe) {
      try {
        const { leads, blocked } = await directoryScraper.scrapeDirectory(recipe);
        if (blocked) {
          literaryBlocked = true;
        } else {
          for (const lead of leads) await db.upsertLead(lead);
          literaryCount = leads.length;
        }
      } catch (err) {
        console.error(`[scheduler] directory scrape failed for "${recipe}":`, err.message);
      }
    }

    const pending = await db.getLeadsPendingEnrichment(200);
    const limiter = pLimit(5);
    await Promise.all(
      pending.map((lead) =>
        limiter(async () => {
          await enrichLead(lead);
          enrichedCount += 1;
        })
      )
    );

    await db.finishPipelineRun(run.id, {
      status: 'done',
      local_scraped_count: localCount,
      literary_scraped_count: literaryCount,
      literary_blocked: literaryBlocked,
      enriched_count: enrichedCount,
    });
  } catch (err) {
    await db.finishPipelineRun(run.id, {
      status: 'error',
      local_scraped_count: localCount,
      literary_scraped_count: literaryCount,
      literary_blocked: literaryBlocked,
      enriched_count: enrichedCount,
      error: err.message,
    });
  }
}

function msUntilNextRun(lastRun) {
  if (!lastRun) return 0; // never run before -- run immediately
  const dueAt = new Date(lastRun.started_at).getTime() + ONE_DAY_MS;
  return Math.max(0, dueAt - Date.now());
}

// Reads the last run from the DB rather than tracking state in memory, so a
// redeploy or restart doesn't cause a duplicate run or a missed one -- it just
// recomputes the correct delay from what's actually persisted.
async function scheduleNext() {
  const [lastRun] = await db.getLatestPipelineRuns(1);
  const delay = msUntilNextRun(lastRun);
  console.log(`[scheduler] next automated run in ${Math.round(delay / 60000)} minute(s)`);

  setTimeout(async () => {
    try {
      await runDailyPipeline();
    } catch (err) {
      console.error('[scheduler] daily pipeline crashed:', err);
    }
    scheduleNext();
  }, delay);
}

function start() {
  scheduleNext().catch((err) => console.error('[scheduler] failed to schedule:', err));
}

module.exports = { start, runDailyPipeline };
