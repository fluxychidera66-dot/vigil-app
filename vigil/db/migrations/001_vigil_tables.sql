-- ============================================================
--  Vigil Database Migrations
--  Run this in your PostgreSQL database (OpenReplay's DB or Supabase)
--  This script is idempotent – safe to run multiple times.
-- ============================================================

-- Sites to monitor
CREATE TABLE IF NOT EXISTS vigil_sites (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER,  -- REFERENCES projects(id) ON DELETE CASCADE (OpenReplay)
  url         TEXT NOT NULL,
  name        TEXT NOT NULL,
  config      JSONB DEFAULT '{}',  -- frequencies, critical_pages, regions, alerts
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Recorded transaction flows
CREATE TABLE IF NOT EXISTS vigil_transactions (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES vigil_sites(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  steps       JSONB NOT NULL,            -- array of {action, selector, value, description}
  schedule    TEXT DEFAULT '*/15 * * * *',  -- cron expression
  regions     TEXT[] DEFAULT ARRAY['us-east-1'],
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Failure incidents
CREATE TABLE IF NOT EXISTS vigil_incidents (
  id                    SERIAL PRIMARY KEY,
  site_id               INTEGER NOT NULL REFERENCES vigil_sites(id) ON DELETE CASCADE,
  transaction_id        INTEGER REFERENCES vigil_transactions(id) ON DELETE SET NULL,
  incident_type         TEXT NOT NULL,    -- 'page_failure' | 'transaction_failure'
  region                TEXT,
  failure_step          TEXT,
  failure_reason        TEXT,
  screenshot_full_url   TEXT,            -- full Supabase Storage URL (Pro users)
  screenshot_blurred_url TEXT,           -- blurred teaser URL (all users)
  console_logs          JSONB DEFAULT '[]',
  network_errors        JSONB DEFAULT '[]',
  session_id            TEXT,            -- OpenReplay session ID if linked
  resolved_at           TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- Alerts sent
CREATE TABLE IF NOT EXISTS vigil_alerts (
  id          SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES vigil_incidents(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,    -- 'email' | 'slack' | 'webhook'
  payload     JSONB DEFAULT '{}',
  status      TEXT DEFAULT 'sent',  -- 'sent' | 'failed'
  sent_at     TIMESTAMP DEFAULT NOW()
);

-- Page check history (for uptime analytics)
CREATE TABLE IF NOT EXISTS vigil_page_checks (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES vigil_sites(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  status_code   INTEGER,
  load_time_ms  INTEGER,
  error         TEXT,
  region        TEXT DEFAULT 'us-east-1',
  checked_at    TIMESTAMP DEFAULT NOW()
);

-- Transaction run history
CREATE TABLE IF NOT EXISTS vigil_transaction_runs (
  id              SERIAL PRIMARY KEY,
  transaction_id  INTEGER NOT NULL REFERENCES vigil_transactions(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,    -- 'success' | 'failure'
  duration_ms     INTEGER,
  failure_step    TEXT,
  failure_reason  TEXT,
  incident_id     INTEGER REFERENCES vigil_incidents(id) ON DELETE SET NULL,
  region          TEXT,
  ran_at          TIMESTAMP DEFAULT NOW()
);

-- Subscription tiers (linked to OpenReplay users)
CREATE TABLE IF NOT EXISTS vigil_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,   -- OpenReplay user ID
  tier        TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'growth' | 'business' | 'pro'
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  current_period_end    TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vigil_incidents_site_id ON vigil_incidents(site_id);
CREATE INDEX IF NOT EXISTS idx_vigil_incidents_created_at ON vigil_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vigil_incidents_resolved_at ON vigil_incidents(resolved_at);
CREATE INDEX IF NOT EXISTS idx_vigil_page_checks_site_id ON vigil_page_checks(site_id);
CREATE INDEX IF NOT EXISTS idx_vigil_page_checks_checked_at ON vigil_page_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_vigil_transactions_site_id ON vigil_transactions(site_id);
CREATE INDEX IF NOT EXISTS idx_vigil_transaction_runs_ran_at ON vigil_transaction_runs(ran_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vigil_sites_updated_at') THEN
    CREATE TRIGGER update_vigil_sites_updated_at BEFORE UPDATE ON vigil_sites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vigil_transactions_updated_at') THEN
    CREATE TRIGGER update_vigil_transactions_updated_at BEFORE UPDATE ON vigil_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vigil_subscriptions_updated_at') THEN
    CREATE TRIGGER update_vigil_subscriptions_updated_at BEFORE UPDATE ON vigil_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Insert sample data (remove in production)
-- INSERT INTO vigil_sites (url, name, config) VALUES
--   ('https://example.com', 'My Store', '{"check_interval": 15, "critical_pages": ["/checkout"]}');

SELECT 'Vigil migrations applied successfully' AS status;
