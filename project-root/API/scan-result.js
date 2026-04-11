const { ensureSchema, pool } = require("../lib/db");

function isAuthorized(req) {
  const expected = process.env.AI_READ_API_KEY;
  if (!expected) {
    return false;
  }
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${expected}`;
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

  const leadId = Number(req.query.lead_id);
  if (!Number.isInteger(leadId) || leadId < 1) {
    return res.status(400).json({ error: "lead_id query param is required" });
  }

  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, lead_id, website, status, risk_label, risk_score, detected_issues,
              remediated_html, legal_disclaimer, created_at, updated_at
       FROM compliance_scans
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [leadId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "No scan found for that lead_id" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
