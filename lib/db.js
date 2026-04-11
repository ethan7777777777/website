const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_requests (
      id BIGSERIAL PRIMARY KEY,
      business_name TEXT NOT NULL,
      email TEXT NOT NULL,
      locations INTEGER NOT NULL CHECK (locations > 0),
      website TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_compliance_scans_lead_id_created_at
    ON compliance_scans(lead_id, created_at DESC)
  `);

  schemaReady = true;
}

module.exports = {
  pool,
  ensureSchema
};
