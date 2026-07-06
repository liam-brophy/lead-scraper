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
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_fit_score ON leads (fit_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source);
