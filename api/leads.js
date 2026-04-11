const { ensureSchema, getPool } = require("../lib/db");

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
    const query = req.query || {};
    const rawLimit = Number(query.limit || 50);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 50;

    await ensureSchema();
    const pool = getPool();
    const result = await pool.query(
      `SELECT
          l.id,
          l.business_name,
          l.email,
          l.locations,
          l.website,
          l.plan,
          l.payment_status,
          l.created_at,
          l.report_token,
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
      leads: result.rows.map((lead) => ({
        ...lead,
        report_url: `/api/public-report?lead_id=${lead.id}&token=${lead.report_token}`,
        download_url:
          lead.plan === "fix_299" && lead.payment_status === "paid"
            ? `/api/download-remediated?lead_id=${lead.id}&token=${lead.report_token}`
            : null
      }))
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
