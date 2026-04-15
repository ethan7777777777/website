const { ensureSchema, getPool } = require("./db");
const { scrapeWebsiteBundle } = require("./firecrawl");
const { generatePaidRemediation } = require("./remediation-engine");

function getHtmlFromFirecrawlRaw(raw) {
  if (!raw || typeof raw !== "object") return "";

  const candidates = [];
  const result = raw.result || raw.data || {};

  const sourceArrays = [
    result?.data?.sources,
    result?.data?.results,
    result?.data?.pages,
    raw?.pages
  ];

  for (const list of sourceArrays) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const html = item?.rawHtml || item?.html || item?.content || "";
      if (html) candidates.push(String(html));
    }
  }

  return candidates.filter(Boolean).join("\n\n");
}

async function fetchLeadWithLatestScan(leadId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
        l.id AS lead_id,
        l.website,
        l.plan,
        l.payment_status,
        s.id AS scan_id,
        s.status AS scan_status,
        s.detected_issues,
        s.firecrawl_raw,
        s.remediated_html
     FROM compliance_requests l
     LEFT JOIN LATERAL (
       SELECT id, status, detected_issues, firecrawl_raw, remediated_html
       FROM compliance_scans
       WHERE lead_id = l.id
       ORDER BY created_at DESC
       LIMIT 1
     ) s ON true
     WHERE l.id = $1
     LIMIT 1`,
    [leadId]
  );

  return result.rows[0] || null;
}

async function markRemediationStatus(scanId, status, errorMessage) {
  if (!scanId) return;
  const pool = getPool();
  await pool.query(
    `UPDATE compliance_scans
     SET remediation_status = $2,
         remediation_error = $3,
         remediated_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE remediated_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [scanId, status, errorMessage || null]
  );
}

async function generatePaidRemediationForLead(leadId, options = {}) {
  await ensureSchema();
  const force = options.force === true;
  const row = await fetchLeadWithLatestScan(leadId);

  if (!row) {
    throw new Error("Lead not found");
  }
  if (row.plan !== "fix_299") {
    throw new Error("Lead is not on paid remediation plan");
  }
  if (row.payment_status !== "paid") {
    throw new Error("Payment is not complete for this lead");
  }
  if (!row.scan_id) {
    throw new Error("No scan found for this lead");
  }

  if (!force && row.remediated_html) {
    return { status: "ready", reused: true, scanId: row.scan_id };
  }

  await markRemediationStatus(row.scan_id, "processing", null);

  try {
    let html = getHtmlFromFirecrawlRaw(row.firecrawl_raw);
    if (!html) {
      const fallback = await scrapeWebsiteBundle(row.website);
      html = String(fallback.html || "");
    }

    if (!html) {
      throw new Error("No source HTML available to generate remediated output");
    }

    const issues = Array.isArray(row.detected_issues) ? row.detected_issues : [];
    const generated = generatePaidRemediation({
      website: row.website,
      html,
      issues
    });

    const pool = getPool();
    await pool.query(
      `UPDATE compliance_scans
       SET remediated_html = $2,
           firecrawl_raw = jsonb_set(
             COALESCE(firecrawl_raw, '{}'::jsonb),
             '{remediation_analysis}',
             $3::jsonb,
             true
           ),
           remediation_status = 'ready',
           remediation_error = NULL,
           remediated_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [row.scan_id, generated.remediatedHtml, JSON.stringify(generated.analysis)]
    );

    return {
      status: "ready",
      reused: false,
      scanId: row.scan_id,
      analysis: generated.analysis
    };
  } catch (error) {
    await markRemediationStatus(row.scan_id, "failed", error.message || "Unknown remediation error");
    throw error;
  }
}

module.exports = {
  generatePaidRemediationForLead
};
