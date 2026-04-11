const { ensureSchema, pool } = require("../lib/db");

function isAuthorized(req) {
  const expected = process.env.AI_READ_API_KEY;
  if (!expected) {
    return false;
  }

  const header = req.headers.authorization || "";
  return header === `Bearer ${expected}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const rawLimit = Number(req.query.limit || 50);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 50;

    await ensureSchema();
    const result = await pool.query(
      `SELECT
          l.id,
          l.business_name,
          l.email,
          l.locations,
          l.website,
          l.created_at,
          s.status AS latest_scan_status,
          s.risk_label AS latest_risk_label,
          s.risk_score AS latest_risk_score
       FROM compliance_requests l
       LEFT JOIN LATERAL (
         SELECT status, risk_label, risk_score
         FROM compliance_scans cs
         WHERE cs.lead_id = l.id
         ORDER BY cs.created_at DESC
         LIMIT 1
       ) s ON true
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.status(200).json({
      count: result.rowCount,
      leads: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
