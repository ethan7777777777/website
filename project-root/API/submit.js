const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

let db;

function getDbPath() {
  const localDataDir = path.join(process.cwd(), "data");
  const isVercel = Boolean(process.env.VERCEL);

  if (isVercel) {
    return path.join("/tmp", "compliancecurrent.db");
  }

  if (!fs.existsSync(localDataDir)) {
    fs.mkdirSync(localDataDir, { recursive: true });
  }

  return path.join(localDataDir, "compliancecurrent.db");
}

function run(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function initDb() {
  if (db) {
    return Promise.resolve(db);
  }

  const dbPath = getDbPath();

  return new Promise((resolve, reject) => {
    const instance = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        await run(
          instance,
          `CREATE TABLE IF NOT EXISTS compliance_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            email TEXT NOT NULL,
            locations INTEGER NOT NULL,
            website TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`
        );
        db = instance;
        resolve(db);
      } catch (schemaError) {
        reject(schemaError);
      }
    });
  });
}

async function saveLead(dbConn, payload) {
  const sql =
    "INSERT INTO compliance_requests (business_name, email, locations, website) VALUES (?, ?, ?, ?)";
  const params = [
    payload.business_name,
    payload.email,
    payload.locations,
    payload.website
  ];
  return run(dbConn, sql, params);
}

async function queueFutureScan(website) {
  // Future step:
  // 1) fetch(website)
  // 2) parse HTML
  // 3) detect CCPA compliance signals
  return { queued: false, website };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { business_name, email, locations, website } = req.body || {};

    if (!business_name || !email || !locations || !website) {
      return res.status(400).json({
        error: "Missing required fields: business_name, email, locations, website"
      });
    }

    const normalizedPayload = {
      business_name: String(business_name).trim(),
      email: String(email).trim().toLowerCase(),
      locations: Number(locations),
      website: String(website).trim()
    };

    if (!Number.isInteger(normalizedPayload.locations) || normalizedPayload.locations < 1) {
      return res.status(400).json({ error: "locations must be a positive integer" });
    }

    try {
      // Validates a proper URL format early before future scraping.
      new URL(normalizedPayload.website);
    } catch (urlError) {
      return res.status(400).json({ error: "website must be a valid URL" });
    }

    const dbConn = await initDb();
    const result = await saveLead(dbConn, normalizedPayload);
    await queueFutureScan(normalizedPayload.website);

    return res.status(200).json({
      message: "Lead captured successfully",
      id: result.lastID
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
