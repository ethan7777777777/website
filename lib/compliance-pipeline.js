const { getPool, ensureSchema } = require("./db");
const { scrapeWebsiteBundle } = require("./firecrawl");
const { analyzeCcpaCompliance } = require("./ccpa");

async function fetchPageDirect(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "ComplianceCurrentBot/1.0 (+https://compliancecurrent.com)"
    },
    redirect: "follow",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Direct fetch failed (${response.status}) for ${url}`);
  }

  const html = await response.text();
  return {
    url,
    html: html || "",
    markdown: html || ""
  };
}

function toAbsoluteUrl(base, pathOrUrl) {
  try {
    return new URL(pathOrUrl, base).toString();
  } catch (_e) {
    return "";
  }
}

async function buildDirectFallbackBundle(website, reason) {
  const targets = Array.from(
    new Set(
      [
        website,
        toAbsoluteUrl(website, "/privacy-policy"),
        toAbsoluteUrl(website, "/privacy"),
        toAbsoluteUrl(website, "/privacy-practices"),
        toAbsoluteUrl(website, "/do-not-sell"),
        toAbsoluteUrl(website, "/privacy-request"),
        toAbsoluteUrl(website, "/contact")
      ].filter(Boolean)
    )
  ).slice(0, 7);

  const pages = [];
  for (const target of targets) {
    try {
      const page = await fetchPageDirect(target);
      pages.push(page);
    } catch (_e) {
      // best effort
    }
  }

  const combinedHtml = pages.map((p) => p.html).filter(Boolean).join("\n\n");
  const combinedMarkdown = pages.map((p) => p.markdown).filter(Boolean).join("\n\n");
  if (!combinedHtml && !combinedMarkdown) {
    throw new Error("Direct fallback could not retrieve website content");
  }

  return {
    html: combinedHtml,
    markdown: combinedMarkdown,
    pages_scanned: pages.map((p) => ({ url: p.url, kind: "pipeline-direct-fallback" })),
    raw: {
      mode: "pipeline_direct_fallback",
      reason: reason || null,
      targeted_urls: targets
    }
  };
}

function isScrapeUsable(scrape) {
  const combined = `${scrape.html || ""} ${scrape.markdown || ""}`.toLowerCase();
  const textLength = combined.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const pagesCount = Array.isArray(scrape.pages_scanned) ? scrape.pages_scanned.length : 0;
  const extractedFindingsCount = Array.isArray(scrape.raw?.extracted_findings)
    ? scrape.raw.extracted_findings.length
    : 0;
  const strongBlockedMarkers = [
    "access denied",
    "forbidden",
    "verify you are human",
    "cloudflare",
    "authentication required",
    "enable javascript",
    "attention required",
    "cf-challenge",
    "security check to access"
  ];
  const softMarkers = ["captcha", "g-recaptcha", "hcaptcha"];
  const matchedStrong = strongBlockedMarkers.filter((marker) => combined.includes(marker));
  const matchedSoft = softMarkers.filter((marker) => combined.includes(marker));
  const hasMeaningfulSiteSignals =
    combined.includes("privacy policy") ||
    combined.includes("services") ||
    combined.includes("contact") ||
    combined.includes("about") ||
    combined.includes("cookie") ||
    combined.includes("do not sell") ||
    combined.includes("california");

  const hardBlocked = matchedStrong.length > 0 && textLength < 1200 && !hasMeaningfulSiteSignals;
  const likelyFalsePositiveSoftCaptcha = matchedSoft.length > 0 && textLength > 4000 && hasMeaningfulSiteSignals;
  const blocked = hardBlocked || (matchedSoft.length > 0 && !likelyFalsePositiveSoftCaptcha && textLength < 1500);
  const hasEnoughText = textLength >= 350;
  const hasEvidenceFromBreadth = pagesCount >= 2 && textLength >= 220;
  const hasEvidenceFromExtraction = extractedFindingsCount > 0 && textLength >= 140;
  const usable = (hasEnoughText || hasEvidenceFromBreadth || hasEvidenceFromExtraction || hasMeaningfulSiteSignals) && !blocked;

  return {
    usable,
    textLength,
    matchedMarkers: [...matchedStrong, ...matchedSoft],
    hasMeaningfulSiteSignals,
    pagesCount,
    extractedFindingsCount
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
         remediation_status = 'failed',
         remediation_error = $5,
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
      payload.firecrawlRaw ? JSON.stringify(payload.firecrawlRaw) : null,
      String(payload.message || "Scan failed")
    ]
  );
}

async function runComplianceScanForLead(leadId, website) {
  await ensureSchema();
  const scanId = await createPendingScan(leadId, website);

  try {
    const pool = getPool();
    let scrape;
    try {
      scrape = await scrapeWebsiteBundle(website);
    } catch (scanError) {
      try {
        scrape = await buildDirectFallbackBundle(website, scanError.message);
      } catch (_fallbackError) {
        throw scanError;
      }
    }
    const quality = isScrapeUsable(scrape);
    if (!quality.usable) {
      await markScanFailed(scanId, {
        id: "insufficient_scan_input",
        category: "Scan Quality",
        title: "Unable to analyze website content reliably",
        recommendation:
          "Website content may be blocked or too limited for a reliable compliance assessment. Retry with crawl access enabled.",
        message: `Text length=${quality.textLength}; pages=${quality.pagesCount}; extracted_findings=${quality.extractedFindingsCount}; markers=${quality.matchedMarkers.join(", ") || "none"}`,
        firecrawlRaw: scrape.raw
      });
      return { scanId, status: "failed", error: "Insufficient or blocked website content" };
    }

    const analysis = analyzeCcpaCompliance({
      website,
      html: scrape.html,
      markdown: scrape.markdown,
      pagesScannedCount: Array.isArray(scrape.pages_scanned) ? scrape.pages_scanned.length : 1
    });

    await pool.query(
      `UPDATE compliance_scans
       SET status = 'completed',
           remediation_status = 'baseline_ready',
           remediation_error = NULL,
           risk_label = $2,
           risk_score = $3,
           detected_issues = $4::jsonb,
           firecrawl_raw = $5::jsonb,
           remediated_html = $6,
           remediated_at = NOW(),
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
