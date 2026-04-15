const { ensureSchema, getPool } = require("../lib/db");
const { generatePaidRemediationForLead } = require("../lib/remediation-worker");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const leadId = Number(query.lead_id);
  const token = String(query.token || "");

  if (!Number.isInteger(leadId) || leadId < 1 || token.length < 20) {
    return res.status(400).json({ error: "lead_id and token are required" });
  }

  try {
    await ensureSchema();
    const pool = getPool();
    const result = await pool.query(
      `SELECT
          l.plan,
          l.payment_status,
          s.status,
          s.remediated_html,
          s.remediation_status,
          s.remediation_error
       FROM compliance_requests l
       LEFT JOIN LATERAL (
         SELECT status, remediated_html, remediation_status, remediation_error
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
      return res.status(404).json({ error: "Download not found" });
    }

    const row = result.rows[0];
    if (row.plan !== "fix_299") {
      return res.status(403).json({ error: "Download is available for the $299 option only" });
    }

    if (row.payment_status !== "paid") {
      return res.status(402).json({ error: "Payment required before remediated download is available" });
    }

    if (row.status !== "completed") {
      return res.status(409).json({ error: "Scan must complete before remediated download is available" });
    }

    if (!row.remediated_html || row.remediation_status !== "ready") {
      try {
        await generatePaidRemediationForLead(leadId, { force: true });
      } catch (_error) {
        return res.status(409).json({
          error: "Remediated code is not ready yet",
          remediation_status: row.remediation_status || "processing",
          remediation_error: row.remediation_error || null
        });
      }

      const refreshed = await pool.query(
        `SELECT remediated_html, remediation_status, remediation_error
         FROM compliance_scans
         WHERE lead_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [leadId]
      );
      const latest = refreshed.rows[0] || {};
      if (!latest.remediated_html || latest.remediation_status !== "ready") {
        return res.status(409).json({
          error: "Remediated code is not ready yet",
          remediation_status: latest.remediation_status || "processing",
          remediation_error: latest.remediation_error || null
        });
      }
      row.remediated_html = latest.remediated_html;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ccpa-remediated-site-${leadId}.html"`);
    return res.status(200).send(row.remediated_html);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
