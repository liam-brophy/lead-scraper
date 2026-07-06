#!/usr/bin/env node
require('dotenv').config();

const pLimit = require('p-limit');
const db = require('./db');
const googlePlaces = require('./scrapers/googlePlaces');
const directoryScraper = require('./scrapers/directoryScraper');
const { enrichLead } = require('./enrich');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

async function cmdScrapeLocal(args) {
  if (!args.query) throw new Error('--query is required, e.g. --query bakery');
  const leads = await googlePlaces.scrapeLocal({
    query: args.query,
    city: args.city,
    maxPages: args.maxPages ? Number(args.maxPages) : undefined,
  });
  for (const lead of leads) await db.upsertLead(lead);
  console.log(`scrape-local: upserted ${leads.length} leads`);
}

async function cmdScrapeDirectory(args) {
  if (!args.recipe) {
    throw new Error(`--recipe is required. Known recipes: ${directoryScraper.listRecipes().join(', ')}`);
  }
  const { leads, blocked, reason } = await directoryScraper.scrapeDirectory(args.recipe);
  if (blocked) {
    console.log(`scrape-directory: blocked -- ${reason}`);
    return;
  }
  for (const lead of leads) await db.upsertLead(lead);
  console.log(`scrape-directory: upserted ${leads.length} leads`);
}

async function cmdEnrich(args) {
  const limit = args.limit ? Number(args.limit) : 50;
  const leads = await db.getLeadsPendingEnrichment(limit);
  const limiter = pLimit(5);
  let count = 0;
  await Promise.all(
    leads.map((lead) =>
      limiter(async () => {
        await enrichLead(lead);
        count += 1;
      })
    )
  );
  console.log(`enrich: processed ${count} leads`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  await db.migrate();

  switch (command) {
    case 'scrape-local':
      await cmdScrapeLocal(args);
      break;
    case 'scrape-directory':
      await cmdScrapeDirectory(args);
      break;
    case 'enrich':
      await cmdEnrich(args);
      break;
    default:
      console.log(`Usage:
  node cli.js scrape-local --query bakery --city "Providence, RI"
  node cli.js scrape-directory --recipe clmp
  node cli.js enrich --limit 50`);
      process.exitCode = 1;
  }

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
