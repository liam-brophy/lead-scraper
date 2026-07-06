-- Idempotent schema, run on server boot (see db.js#migrate).
CREATE TABLE IF NOT EXISTS leads (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT,
  source           TEXT NOT NULL,          -- e.g. 'google_places', 'directory:clmp'
  source_id        TEXT NOT NULL,          -- place_id, or normalized hash for directory leads
  city             TEXT,
  site_url         TEXT,
  phone            TEXT,
  email            TEXT,
  email_confidence TEXT,                   -- 'found' | 'guessed' | null
  signals          JSONB NOT NULL DEFAULT '{}'::jsonb,
  fit_score        INTEGER,
  status           TEXT NOT NULL DEFAULT 'new', -- new|contacted|replied|booked|dead
  notes            TEXT,
  queued_at        TIMESTAMPTZ,             -- set when added to the outreach queue; NULL = not queued
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

-- Handles the production table that already existed before queued_at was added.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_fit_score ON leads (fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source);

-- Deliberately no index on queued_at: a partial index here tripped a pg-mem
-- bug in the test suite (IS NULL queries silently returned nothing once the
-- partial index existed), and at this table size a full scan for the queue
-- filter costs nothing worth indexing for.
DROP INDEX IF EXISTS idx_leads_queued;

-- One row per automated daily pipeline run, so the dashboard can show what's
-- actually happened without needing the in-memory job tracker (which resets
-- on every restart/redeploy).
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id                  SERIAL PRIMARY KEY,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running', -- running|done|error
  local_categories    JSONB,                  -- categories searched this run, e.g. ["dentist","bakery"]
  literary_recipe     TEXT,                   -- recipe scraped this run, if any
  local_scraped_count INTEGER,
  literary_scraped_count INTEGER,
  literary_blocked    BOOLEAN,
  enriched_count      INTEGER,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs (started_at DESC);
