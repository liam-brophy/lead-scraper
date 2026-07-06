// Runs the real upsert/dedup SQL from db.js against pg-mem (an in-memory Postgres
// emulator) instead of a live database -- this is a solo-dev tool with no CI, so
// the test needs to work with `npm test` and nothing else installed.
//
// db.js does `require('pg')` at load time, so we swap that module out for pg-mem's
// compatible adapter before requiring db.js. This has to happen before any other
// test file requires db.js/server.js against a real DATABASE_URL.
const Module = require('module');
const { newDb } = require('pg-mem');

const memDb = newDb({ autoCreateForeignKeyIndices: true });
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
