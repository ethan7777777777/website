const { ensureSchema, getPool } = require("../lib/db");

function isValidInput(leadId, token) {
  return Number.isInteger(leadId) && leadId > 0 && typeof token === "string" && token.length >= 20;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const leadId = Number(query.lead_id);
  const token = String(query.token || "");

  if (!isValidInput(leadId, token)) {
    return res.status(400).json({ error: "lead_id and token are required" });
  }

  try {
    await ensureSchema();
    const pool = getPool();
    const result = await pool.query(
      `SELECT
          l.id AS lead_id,
          l.business_name,
          l.website,
          l.plan,
          l.payment_status,
          l.stripe_session_id,
          s.id AS scan_id,
          s.status,
          s.risk_label,
          s.risk_score,
          s.detected_issues,
          s.remediated_html,
          s.remediation_status,
          s.remediation_error,
          s.remediated_at,
          s.legal_disclaimer,
          s.updated_at
       FROM compliance_requests l
       LEFT JOIN LATERAL (
         SELECT id, status, risk_label, risk_score, detected_issues, remediated_html, remediation_status, remediation_error, remediated_at, legal_disclaimer, updated_at
         FROM compliance_scans
         WHERE lead_id = l.id
         ORDER BY created_at DESC
         LIMIT 1
       ) s ON true
       WHERE l.id = $1 AND l.report_token = $2
       LIMIT 1`,
      [leadId, token]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Report not found" });
    }

    const row = result.rows[0];
    const downloadUrl =
      row.plan === "fix_299" && row.payment_status === "paid" && row.status === "completed"
        ? `/api/download-remediated?lead_id=${row.lead_id}&token=${token}`
        : null;

    return res.status(200).json({
      lead_id: row.lead_id,
      business_name: row.business_name,
      website: row.website,
      plan: row.plan,
      payment_status: row.payment_status,
      scan_id: row.scan_id,
      status: row.status,
      risk_label: row.risk_label,
      risk_score: row.risk_score,
      issues: row.detected_issues || [],
      ccpa_uncompliances: row.detected_issues || [],
      legal_disclaimer: row.legal_disclaimer,
      remediation_status: row.remediation_status,
      remediation_error: row.remediation_error,
      remediated_at: row.remediated_at,
      updated_at: row.updated_at,
      download_url: downloadUrl,
      payment_required: row.plan === "fix_299" && row.payment_status !== "paid"
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
