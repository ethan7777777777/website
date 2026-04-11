const { getPool, ensureSchema } = require("./db");
const { scrapeWebsite } = require("./firecrawl");
const { analyzeCcpaCompliance } = require("./ccpa");

function isScrapeUsable(scrape) {
  const combined = `${scrape.html || ""} ${scrape.markdown || ""}`.toLowerCase();
  const textLength = combined.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const blockedMarkers = [
    "access denied",
    "forbidden",
    "verify you are human",
    "captcha",
    "cloudflare",
    "authentication required",
    "enable javascript"
  ];
  const matchedMarkers = blockedMarkers.filter((marker) => combined.includes(marker));
  const usable = textLength >= 800 && matchedMarkers.length === 0;

  return {
    usable,
    textLength,
    matchedMarkers
  };
}

async function createPendingScan(leadId, website) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO compliance_scans (lead_id, website, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [leadId, website]
  );
  return result.rows[0].id;
}

async function markScanFailed(scanId, details) {
  const payload = typeof details === "string" ? { message: details } : details || {};
  const pool = getPool();
  await pool.query(
    `UPDATE compliance_scans
     SET status = 'failed',
         risk_label = NULL,
         risk_score = NULL,
         detected_issues = $2::jsonb,
         firecrawl_raw = COALESCE($4::jsonb, firecrawl_raw),
         legal_disclaimer = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [
      scanId,
      JSON.stringify([
        {
          id: payload.id || "scan_failed",
          category: payload.category || "System",
          title: payload.title || "Firecrawl scan failed",
          severity: "high",
          recommendation:
            payload.recommendation ||
            "Retry the scan and verify FIRECRAWL_API_KEY and target site accessibility.",
          details: String(payload.message || "Unknown error")
        }
      ]),
      "Disclaimer: I am an AI, not a lawyer. This information is based on public CCPA enforcement records and guidelines and does not constitute legal advice."
      ,
      payload.firecrawlRaw ? JSON.stringify(payload.firecrawlRaw) : null
    ]
  );
}

async function runComplianceScanForLead(leadId, website) {
  await ensureSchema();
  const scanId = await createPendingScan(leadId, website);

  try {
    const pool = getPool();
    const scrape = await scrapeWebsite(website);
    const quality = isScrapeUsable(scrape);
    if (!quality.usable) {
      await markScanFailed(scanId, {
        id: "insufficient_scan_input",
        category: "Scan Quality",
        title: "Unable to analyze website content reliably",
        recommendation:
          "Website content may be blocked or too limited for a reliable compliance assessment. Retry with crawl access enabled.",
        message: `Text length=${quality.textLength}; markers=${quality.matchedMarkers.join(", ") || "none"}`,
        firecrawlRaw: scrape.raw
      });
      return { scanId, status: "failed", error: "Insufficient or blocked website content" };
    }

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
        JSON.stringify({
          ...scrape.raw,
          ccpa_evidence: analysis.evidence
        }),
        analysis.remediatedHtml,
        analysis.legalDisclaimer
      ]
    );

    return { scanId, status: "completed", risk: analysis.risk };
  } catch (error) {
    await markScanFailed(scanId, { message: error.message });
    return { scanId, status: "failed", error: error.message };
  }
}

module.exports = {
  runComplianceScanForLead
};
