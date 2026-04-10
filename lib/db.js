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

  schemaReady = true;
}

module.exports = {
  pool,
  ensureSchema
};
