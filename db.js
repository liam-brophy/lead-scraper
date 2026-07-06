const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

async function listLeads({ status, source, minScore, search } = {}) {
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

async function patchLead(id, { status, notes }) {
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

module.exports = {
  pool,
  migrate,
  upsertLead,
  listLeads,
  getLead,
  getLeadsPendingEnrichment,
  patchLead,
  applyEnrichment,
};
