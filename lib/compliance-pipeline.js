const { pool, ensureSchema } = require("./db");
const { scrapeWebsite } = require("./firecrawl");
const { analyzeCcpaCompliance } = require("./ccpa");

async function createPendingScan(leadId, website) {
  const result = await pool.query(
    `INSERT INTO compliance_scans (lead_id, website, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [leadId, website]
  );
  return result.rows[0].id;
}

async function markScanFailed(scanId, error) {
  await pool.query(
    `UPDATE compliance_scans
     SET status = 'failed',
         detected_issues = $2::jsonb,
         legal_disclaimer = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [
      scanId,
      JSON.stringify([
        {
          id: "scan_failed",
          category: "System",
          title: "Firecrawl scan failed",
          severity: "high",
          recommendation: "Retry the scan and verify FIRECRAWL_API_KEY and target site accessibility.",
          details: String(error.message || error)
        }
      ]),
      "Disclaimer: I am an AI, not a lawyer. This information is based on public CCPA enforcement records and guidelines and does not constitute legal advice."
    ]
  );
}

async function runComplianceScanForLead(leadId, website) {
  await ensureSchema();
  const scanId = await createPendingScan(leadId, website);

  try {
    const scrape = await scrapeWebsite(website);
    const analysis = analyzeCcpaCompliance({
      website,
      html: scrape.html,
      markdown: scrape.markdown
    });

    await pool.query(
      `UPDATE compliance_scans
       SET status = 'completed',
           risk_label = $2,
           risk_score = $3,
           detected_issues = $4::jsonb,
           firecrawl_raw = $5::jsonb,
           remediated_html = $6,
           legal_disclaimer = $7,
           updated_at = NOW()
       WHERE id = $1`,
      [
        scanId,
        analysis.risk.label,
        analysis.risk.score,
        JSON.stringify(analysis.issues),
        JSON.stringify(scrape.raw),
        analysis.remediatedHtml,
        analysis.legalDisclaimer
      ]
    );

    return { scanId, status: "completed", risk: analysis.risk };
  } catch (error) {
    await markScanFailed(scanId, error);
    return { scanId, status: "failed", error: error.message };
  }
}

module.exports = {
  runComplianceScanForLead
};
