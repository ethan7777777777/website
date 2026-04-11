const { Pool } = require("pg");

let pool;

function getPool() {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  });

  return pool;
}

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_requests (
      id BIGSERIAL PRIMARY KEY,
      business_name TEXT NOT NULL,
      email TEXT NOT NULL,
      locations INTEGER NOT NULL CHECK (locations > 0),
      website TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE compliance_requests
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free_audit'
  `);

  await db.query(`
    ALTER TABLE compliance_requests
    ADD COLUMN IF NOT EXISTS report_token TEXT
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_requests_report_token
    ON compliance_requests(report_token)
    WHERE report_token IS NOT NULL
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_scans (
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES compliance_requests(id) ON DELETE CASCADE,
      website TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      risk_label TEXT,
      risk_score INTEGER,
      detected_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      firecrawl_raw JSONB,
      remediated_html TEXT,
      legal_disclaimer TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_compliance_scans_lead_id_created_at
    ON compliance_scans(lead_id, created_at DESC)
  `);

  schemaReady = true;
}

module.exports = {
  getPool,
  ensureSchema
};
