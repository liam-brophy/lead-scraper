// Runs the real upsert/dedup SQL from db.js against pg-mem (an in-memory Postgres
// emulator) instead of a live database -- this is a solo-dev tool with no CI, so
// the test needs to work with `npm test` and nothing else installed.
//
// db.js does `require('pg')` at load time, so we swap that module out for pg-mem's
// compatible adapter before requiring db.js. This has to happen before any other
// test file requires db.js/server.js against a real DATABASE_URL.
const Module = require('module');
const { newDb } = require('pg-mem');

const memDb = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
memDb.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
const { Pool } = memDb.adapters.createPg();

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id, ...rest) {
  if (id === 'pg') return { Pool };
  return originalRequire.call(this, id, ...rest);
};

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');

before(async () => {
  await db.migrate();
});

test('upsertLead: inserts a new lead', async () => {
  const lead = await db.upsertLead({
    name: 'Joe Bakery',
    source: 'google_places',
    source_id: 'place-1',
    city: 'Providence',
    phone: '555-1111',
  });
  assert.equal(lead.name, 'Joe Bakery');
  assert.equal(lead.status, 'new');
  assert.equal(lead.notes, null);
});

test('upsertLead: re-scraping the same source/source_id updates in place (dedup)', async () => {
  await db.upsertLead({ name: 'Dedup Co', source: 'google_places', source_id: 'place-dedup', phone: '555-0000' });
  await db.upsertLead({ name: 'Dedup Co', source: 'google_places', source_id: 'place-dedup', phone: '555-9999', site_url: 'https://dedup.co' });

  const rows = await db.pool.query(`SELECT * FROM leads WHERE source_id = 'place-dedup'`);
  assert.equal(rows.rows.length, 1, 'expected exactly one row after re-scraping the same source_id');
  assert.equal(rows.rows[0].phone, '555-9999', 'newer scrape value should win');
  assert.equal(rows.rows[0].site_url, 'https://dedup.co');
});

test('upsertLead: re-scraping never overwrites manually-set status/notes', async () => {
  const lead = await db.upsertLead({ name: 'Manual Co', source: 'google_places', source_id: 'place-manual' });
  await db.patchLead(lead.id, { status: 'contacted', notes: 'called them, follow up Friday' });

  const rescraped = await db.upsertLead({ name: 'Manual Co', source: 'google_places', source_id: 'place-manual', phone: '555-4444' });

  assert.equal(rescraped.id, lead.id);
  assert.equal(rescraped.status, 'contacted');
  assert.equal(rescraped.notes, 'called them, follow up Friday');
  assert.equal(rescraped.phone, '555-4444');
});

test('upsertLead: a bare re-scrape (no signals) preserves prior enrichment', async () => {
  const lead = await db.upsertLead({ name: 'Enriched Co', source: 'google_places', source_id: 'place-enriched' });
  await db.applyEnrichment(lead.id, { email: 'info@enriched.co', email_confidence: 'guessed', signals: { mobileFriendly: false }, fit_score: 42 });

  const rescraped = await db.upsertLead({ name: 'Enriched Co', source: 'google_places', source_id: 'place-enriched', phone: '555-2222' });

  assert.equal(rescraped.fit_score, 42);
  assert.deepEqual(rescraped.signals, { mobileFriendly: false });
  assert.equal(rescraped.email, 'info@enriched.co');
});

test('patchLead: only updates the fields provided', async () => {
  const lead = await db.upsertLead({ name: 'Partial Patch Co', source: 'google_places', source_id: 'place-partial' });
  await db.patchLead(lead.id, { status: 'booked' });
  const afterStatus = await db.getLead(lead.id);
  assert.equal(afterStatus.status, 'booked');

  await db.patchLead(lead.id, { notes: 'great fit' });
  const afterNotes = await db.getLead(lead.id);
  assert.equal(afterNotes.status, 'booked', 'status should be untouched by a notes-only patch');
  assert.equal(afterNotes.notes, 'great fit');
});

test('patchLead: queued toggles queued_at, independent of status', async () => {
  const lead = await db.upsertLead({ name: 'Queue Co', source: 'google_places', source_id: 'place-queue' });

  await db.patchLead(lead.id, { queued: true });
  const queued = await db.getLead(lead.id);
  assert.ok(queued.queued_at, 'queued_at should be set');
  assert.equal(queued.status, 'new', 'queuing a lead should not touch its status');

  await db.patchLead(lead.id, { queued: false });
  const unqueued = await db.getLead(lead.id);
  assert.equal(unqueued.queued_at, null);
});

test('listLeads: queued filter only returns queued leads', async () => {
  const a = await db.upsertLead({ name: 'Queued Alpha', source: 'google_places', source_id: 'queue-a' });
  await db.upsertLead({ name: 'Queued Beta (not queued)', source: 'google_places', source_id: 'queue-b' });
  await db.patchLead(a.id, { queued: true });

  const queuedOnly = await db.listLeads({ queued: true });
  const names = queuedOnly.map((l) => l.name);
  assert.ok(names.includes('Queued Alpha'));
  assert.ok(!names.includes('Queued Beta (not queued)'));
});

test('getLeadsPendingEnrichment: only returns leads without a fit_score', async () => {
  await db.upsertLead({ name: 'Needs Enrichment', source: 'google_places', source_id: 'place-pending' });
  const scored = await db.upsertLead({ name: 'Already Scored', source: 'google_places', source_id: 'place-scored' });
  await db.applyEnrichment(scored.id, { fit_score: 10 });

  const pending = await db.getLeadsPendingEnrichment(100);
  const names = pending.map((l) => l.name);
  assert.ok(names.includes('Needs Enrichment'));
  assert.ok(!names.includes('Already Scored'));
});

test('listLeads: filters by status, source, minScore, and search', async () => {
  const a = await db.upsertLead({ name: 'Filter Alpha', source: 'directory:clmp', source_id: 'filter-a', city: 'Boston' });
  await db.patchLead(a.id, { status: 'booked' });
  await db.applyEnrichment(a.id, { fit_score: 80 });

  await db.upsertLead({ name: 'Filter Beta', source: 'google_places', source_id: 'filter-b', city: 'Chicago' });

  const byStatus = await db.listLeads({ status: 'booked' });
  assert.ok(byStatus.every((l) => l.status === 'booked'));

  const bySource = await db.listLeads({ source: 'directory:clmp' });
  assert.ok(bySource.every((l) => l.source === 'directory:clmp'));

  const byMinScore = await db.listLeads({ minScore: 50 });
  assert.ok(byMinScore.every((l) => l.fit_score >= 50));

  const bySearch = await db.listLeads({ search: 'boston' });
  assert.ok(bySearch.some((l) => l.name === 'Filter Alpha'));
});

test('getPrimeTargets: excludes low scores, dead leads, and already-queued leads', async () => {
  const good = await db.upsertLead({ name: 'Prime Good', source: 'google_places', source_id: 'prime-good' });
  await db.applyEnrichment(good.id, { fit_score: 70 });

  const low = await db.upsertLead({ name: 'Prime Low Score', source: 'google_places', source_id: 'prime-low' });
  await db.applyEnrichment(low.id, { fit_score: 10 });

  const dead = await db.upsertLead({ name: 'Prime Dead', source: 'google_places', source_id: 'prime-dead' });
  await db.applyEnrichment(dead.id, { fit_score: 90 });
  await db.patchLead(dead.id, { status: 'dead' });

  const queued = await db.upsertLead({ name: 'Prime Already Queued', source: 'google_places', source_id: 'prime-queued' });
  await db.applyEnrichment(queued.id, { fit_score: 90 });
  await db.patchLead(queued.id, { queued: true });

  const targets = await db.getPrimeTargets();
  const names = targets.map((l) => l.name);
  assert.ok(names.includes('Prime Good'));
  assert.ok(!names.includes('Prime Low Score'));
  assert.ok(!names.includes('Prime Dead'));
  assert.ok(!names.includes('Prime Already Queued'));
});

test('getStatusSummary: counts reflect actual lead state', async () => {
  const before = await db.getStatusSummary();

  const lead = await db.upsertLead({ name: 'Summary Co', source: 'google_places', source_id: 'summary-co' });
  const afterScrape = await db.getStatusSummary();
  assert.equal(afterScrape.totalLeads, before.totalLeads + 1);
  assert.equal(afterScrape.pendingEnrichment, before.pendingEnrichment + 1);

  await db.applyEnrichment(lead.id, { fit_score: 80 });
  const afterEnrich = await db.getStatusSummary();
  assert.equal(afterEnrich.pendingEnrichment, before.pendingEnrichment);
  assert.equal(afterEnrich.primeTargets, before.primeTargets + 1);

  await db.patchLead(lead.id, { queued: true });
  const afterQueue = await db.getStatusSummary();
  assert.equal(afterQueue.queued, before.queued + 1);
  assert.equal(afterQueue.primeTargets, before.primeTargets, 'queuing removes it from prime targets');
});

test('pipeline runs: create, finish, and list in most-recent-first order', async () => {
  const run = await db.createPipelineRun({ local_categories: ['dentist', 'bakery'], literary_recipe: 'clmp' });
  assert.equal(run.status, 'running');
  assert.deepEqual(run.local_categories, ['dentist', 'bakery']);

  const finished = await db.finishPipelineRun(run.id, {
    status: 'done',
    local_scraped_count: 12,
    literary_scraped_count: 24,
    literary_blocked: false,
    enriched_count: 30,
  });
  assert.equal(finished.status, 'done');
  assert.equal(finished.local_scraped_count, 12);
  assert.ok(finished.finished_at);

  const runs = await db.getLatestPipelineRuns(1);
  assert.equal(runs[0].id, run.id);
});
