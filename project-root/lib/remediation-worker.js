const { ensureSchema, getPool } = require("./db");
const { scrapeWebsiteBundle } = require("./firecrawl");
const { generatePaidRemediation } = require("./remediation-engine");
const { loadRemediationContext } = require("./remediation-context");
const { generateRemediationWithModel } = require("./openai-remediation");

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

function applyModelRemediation(baseHtml, modelOutput) {
  const base = String(baseHtml || "");
  const output = String(modelOutput || "").trim();
  if (!output) return base;

  if (/<html[\s>]/i.test(output)) {
    return output;
  }

  let next = base;
  next = next.replace(/<style id="compliancecurrent-theme">[\s\S]*?<\/style>/i, "");
  next = next.replace(/<section id="compliancecurrent-remediation-pack">[\s\S]*?<\/section>/i, "");

  const block = output.includes("compliancecurrent-remediation-pack")
    ? output
    : `<section id="compliancecurrent-remediation-pack">${output}</section>`;

  if (next.includes("</body>")) {
    return next.replace("</body>", `${block}\n</body>`);
  }
  return `${next}\n${block}`;
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
    const deterministic = generatePaidRemediation({
      website: row.website,
      html,
      issues
    });
    const context = loadRemediationContext();
    const previousMemory = row.firecrawl_raw?.remediation_memory || {};

    let finalHtml = deterministic.remediatedHtml;
    let finalAnalysis = {
      ...deterministic.analysis,
      generation_mode: "deterministic_fallback"
    };
    let aiResult = null;
    let aiError = null;

    if (process.env.OPENAI_API_KEY) {
      try {
        aiResult = await generateRemediationWithModel({
          website: row.website,
          html,
          issues,
          integration: deterministic.analysis,
          context,
          memory: previousMemory
        });

        if (aiResult.approved && aiResult.remediated_html) {
          finalHtml = applyModelRemediation(deterministic.remediatedHtml, aiResult.remediated_html);
          finalAnalysis = {
            ...deterministic.analysis,
            generation_mode: "model",
            model: aiResult.model,
            model_summary: aiResult.summary,
            model_breakage_risks: aiResult.breakage_risks,
            model_changes_applied: aiResult.changes_applied,
            model_required_followups: aiResult.required_followups
          };
        } else {
          aiError = "Model review did not approve output; using deterministic fallback";
          finalAnalysis = {
            ...deterministic.analysis,
            generation_mode: "deterministic_fallback_after_model_reject",
            model: aiResult.model,
            model_summary: aiResult.summary,
            model_breakage_risks: aiResult.breakage_risks,
            model_changes_applied: aiResult.changes_applied,
            model_required_followups: aiResult.required_followups
          };
        }
      } catch (error) {
        aiError = error.message || "Model remediation failed; using deterministic fallback";
      }
    }

    const remediationMemory = {
      version: context.version || "default",
      generated_at: new Date().toISOString(),
      website: row.website,
      lead_id: row.lead_id,
      issues_snapshot: issues.slice(0, 20),
      integration_snapshot: deterministic.analysis,
      mode: finalAnalysis.generation_mode,
      model: aiResult?.model || process.env.OPENAI_MODEL || null,
      ai_summary: aiResult?.summary || null,
      ai_breakage_risks: aiResult?.breakage_risks || [],
      ai_changes_applied: aiResult?.changes_applied || [],
      ai_required_followups: aiResult?.required_followups || [],
      previous_memory: previousMemory
    };

    const pool = getPool();
    await pool.query(
      `UPDATE compliance_scans
       SET remediated_html = $2,
           firecrawl_raw = COALESCE(firecrawl_raw, '{}'::jsonb) || $3::jsonb,
           remediation_status = 'ready',
           remediation_error = $4,
           remediated_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [
        row.scan_id,
        finalHtml,
        JSON.stringify({
          remediation_analysis: finalAnalysis,
          remediation_memory: remediationMemory,
          remediation_context_version: context.version || "default",
          ai_remediation: aiResult
            ? {
                model: aiResult.model,
                approved: aiResult.approved,
                summary: aiResult.summary,
                breakage_risks: aiResult.breakage_risks,
                changes_applied: aiResult.changes_applied,
                required_followups: aiResult.required_followups
              }
            : null
        }),
        aiError
      ]
    );

    return {
      status: "ready",
      reused: false,
      scanId: row.scan_id,
      analysis: finalAnalysis
    };
  } catch (error) {
    await markRemediationStatus(row.scan_id, "failed", error.message || "Unknown remediation error");
    throw error;
  }
}

module.exports = {
  generatePaidRemediationForLead
};
