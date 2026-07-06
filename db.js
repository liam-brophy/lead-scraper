const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { PRIME_TARGET_MIN_SCORE } = require('./config');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See .env.example.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Insert or refresh a lead. Scrape-derived fields are updated when the caller supplies
// a new value; `status` and `notes` are never touched here since those are manual edits.
// `signals`/`fit_score` are only overwritten when explicitly provided (enrich pass),
// so a bare scrape upsert doesn't wipe out a previous enrichment.
async function upsertLead(lead) {
  const {
    name, category = null, source, source_id,
    city = null, site_url = null, phone = null,
    email = null, email_confidence = null,
    signals = null, fit_score = null,
  } = lead;

  if (!source || !source_id) {
    throw new Error('upsertLead requires source and source_id');
  }
  if (!name) {
    throw new Error('upsertLead requires name');
  }

  const signalsJson = signals ? JSON.stringify(signals) : null;

  const { rows } = await pool.query(
    `INSERT INTO leads
       (name, category, source, source_id, city, site_url, phone, email, email_confidence, signals, fit_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::jsonb, '{}'::jsonb), $11)
     ON CONFLICT (source, source_id) DO UPDATE SET
       name             = COALESCE(EXCLUDED.name, leads.name),
       category         = COALESCE(EXCLUDED.category, leads.category),
       city             = COALESCE(EXCLUDED.city, leads.city),
       site_url         = COALESCE(EXCLUDED.site_url, leads.site_url),
       phone            = COALESCE(EXCLUDED.phone, leads.phone),
       email            = COALESCE(EXCLUDED.email, leads.email),
       email_confidence = COALESCE(EXCLUDED.email_confidence, leads.email_confidence),
       signals          = CASE WHEN $10 IS NULL THEN leads.signals ELSE EXCLUDED.signals END,
       fit_score        = COALESCE(EXCLUDED.fit_score, leads.fit_score),
       updated_at       = now()
     RETURNING *`,
    [name, category, source, source_id, city, site_url, phone, email, email_confidence, signalsJson, fit_score]
  );
  return rows[0];
}

async function listLeads({ status, source, minScore, search, queued } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (source) {
    params.push(source);
    clauses.push(`source = $${params.length}`);
  }
  if (minScore !== undefined && minScore !== null && minScore !== '') {
    params.push(Number(minScore));
    clauses.push(`fit_score >= $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    clauses.push(`(lower(name) LIKE $${params.length} OR lower(city) LIKE $${params.length})`);
  }
  if (queued === true || queued === 'true') {
    clauses.push(`queued_at IS NOT NULL`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM leads ${where} ORDER BY fit_score DESC NULLS LAST, created_at DESC`,
    params
  );
  return rows;
}

async function getLead(id) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  return rows[0] || null;
}

// Leads that haven't been through the enrich pass yet (or need a re-run), oldest first.
async function getLeadsPendingEnrichment(limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM leads WHERE fit_score IS NULL ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function patchLead(id, { status, notes, queued }) {
  const clauses = [];
  const params = [];

  if (status !== undefined) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    clauses.push(`notes = $${params.length}`);
  }
  if (queued !== undefined) {
    clauses.push(queued ? `queued_at = now()` : `queued_at = NULL`);
  }
  if (!clauses.length) return getLead(id);

  clauses.push(`updated_at = now()`);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE leads SET ${clauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
}

// Update just the enrichment fields for an existing lead (used by emailFinder/siteAnalyzer
// when re-enriching a lead that was already scraped-in).
async function applyEnrichment(id, { email, email_confidence, signals, fit_score }) {
  const { rows } = await pool.query(
    `UPDATE leads SET
       email            = COALESCE($2, email),
       email_confidence = COALESCE($3, email_confidence),
       signals          = COALESCE($4::jsonb, signals),
       fit_score        = COALESCE($5, fit_score),
       updated_at       = now()
     WHERE id = $1
     RETURNING *`,
    [id, email || null, email_confidence || null, signals ? JSON.stringify(signals) : null, fit_score ?? null]
  );
  return rows[0] || null;
}

// Scored, still live, not already earmarked -- the leads actually worth
// putting in front of the user today.
async function getPrimeTargets(limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM leads
     WHERE fit_score >= $1 AND status != 'dead' AND queued_at IS NULL
     ORDER BY fit_score DESC, created_at DESC
     LIMIT $2`,
    [PRIME_TARGET_MIN_SCORE, limit]
  );
  return rows;
}

async function getStatusSummary() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM leads) AS total_leads,
      (SELECT count(*) FROM leads WHERE fit_score >= ${PRIME_TARGET_MIN_SCORE} AND status != 'dead' AND queued_at IS NULL) AS prime_targets,
      (SELECT count(*) FROM leads WHERE fit_score IS NULL) AS pending_enrichment,
      (SELECT count(*) FROM leads WHERE queued_at IS NOT NULL) AS queued
  `);
  const row = rows[0];
  return {
    totalLeads: Number(row.total_leads),
    primeTargets: Number(row.prime_targets),
    pendingEnrichment: Number(row.pending_enrichment),
    queued: Number(row.queued),
  };
}

async function createPipelineRun({ local_categories, literary_recipe }) {
  const { rows } = await pool.query(
    `INSERT INTO pipeline_runs (local_categories, literary_recipe)
     VALUES ($1::jsonb, $2) RETURNING *`,
    [JSON.stringify(local_categories || []), literary_recipe || null]
  );
  return rows[0];
}

async function finishPipelineRun(id, {
  status, local_scraped_count, literary_scraped_count, literary_blocked, enriched_count, error,
}) {
  const { rows } = await pool.query(
    `UPDATE pipeline_runs SET
       finished_at = now(),
       status = $2,
       local_scraped_count = $3,
       literary_scraped_count = $4,
       literary_blocked = $5,
       enriched_count = $6,
       error = $7
     WHERE id = $1
     RETURNING *`,
    [id, status, local_scraped_count ?? null, literary_scraped_count ?? null, literary_blocked ?? null, enriched_count ?? null, error || null]
  );
  return rows[0] || null;
}

async function getLatestPipelineRuns(limit = 5) {
  const { rows } = await pool.query(
    `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  pool,
  migrate,
  upsertLead,
  listLeads,
  getLead,
  getLeadsPendingEnrichment,
  getPrimeTargets,
  getStatusSummary,
  patchLead,
  applyEnrichment,
  createPipelineRun,
  finishPipelineRun,
  getLatestPipelineRuns,
};
