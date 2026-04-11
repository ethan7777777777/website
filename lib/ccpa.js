const LEGAL_DISCLAIMER =
  "Disclaimer: I am an AI, not a lawyer. This information is based on public CCPA enforcement records and guidelines and does not constitute legal advice.";

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function normalizeText(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function buildChecks(text) {
  const requestSignals = [
    text.includes("@") || text.includes("email"),
    text.includes("phone") || text.includes("call") || text.includes("tel:"),
    includesAny(text, ["request form", "submit request", "privacy request", "contact form"])
  ].filter(Boolean).length;

  const hasNoSellStatement = includesAny(text, [
    "we do not sell personal information",
    "we do not sell your personal information",
    "we do not share personal information for cross-context behavioral advertising"
  ]);

  return [
    {
      id: "privacy_policy_presence",
      dimension: "notice_policy",
      severity: "high",
      title: "Missing privacy policy page",
      fail: !includesAny(text, ["privacy policy", "privacy notice", "/privacy-policy", "/privacy"]),
      recommendation: "Publish and link a clear privacy policy describing data collection and usage."
    },
    {
      id: "data_category_disclosure",
      dimension: "notice_policy",
      severity: "high",
      title: "Missing data collection categories",
      fail: !includesAny(text, ["categories of personal information", "personal information we collect", "data we collect"]),
      recommendation: "List all categories of personal information collected and where they come from."
    },
    {
      id: "notice_at_collection",
      dimension: "notice_policy",
      severity: "high",
      title: "Missing notice at collection",
      fail: !includesAny(text, ["notice at collection", "at or before the point of collection", "when we collect your information"]),
      recommendation: "Add notice-at-collection language for forms, booking, and contact workflows."
    },
    {
      id: "ccpa_rights_suite",
      dimension: "consumer_rights",
      severity: "high",
      title: "Incomplete CCPA rights disclosure",
      fail:
        !(
          includesAny(text, ["right to know", "right to access"]) &&
          includesAny(text, ["right to delete", "deletion request"]) &&
          includesAny(text, ["right to correct", "correction request"]) &&
          includesAny(text, ["opt-out", "do not sell", "do not share"])
        ),
      recommendation: "Disclose know/access, delete, correct, and opt-out rights for California consumers."
    },
    {
      id: "do_not_sell_link",
      dimension: "opt_out_controls",
      severity: "high",
      title: "No Do Not Sell/Share mechanism",
      fail:
        !hasNoSellStatement &&
        !includesAny(text, ["do not sell", "do not share my personal information", "your privacy choices"]),
      recommendation: "Provide a conspicuous Do Not Sell or Share link and preference center."
    },
    {
      id: "gpc_support",
      dimension: "opt_out_controls",
      severity: "medium",
      title: "No Global Privacy Control statement",
      fail: !includesAny(text, ["global privacy control", "gpc", "privacy preference signal"]),
      recommendation: "Document and honor browser-level global opt-out signals where required."
    },
    {
      id: "cookie_disclosure",
      dimension: "opt_out_controls",
      severity: "medium",
      title: "Weak cookie/tracking disclosure",
      fail: !includesAny(text, ["cookie", "tracking technologies", "manage cookies", "cookie preferences"]),
      recommendation: "Disclose tracking/cookies and provide consent or preference controls."
    },
    {
      id: "request_channels",
      dimension: "request_operations",
      severity: "high",
      title: "Insufficient request channels",
      fail: requestSignals < 2,
      recommendation: "Offer at least two request methods (email/phone/form) for privacy rights requests."
    },
    {
      id: "identity_verification",
      dimension: "request_operations",
      severity: "medium",
      title: "No identity verification workflow",
      fail: !includesAny(text, ["verify your identity", "identity verification", "authorized agent"]),
      recommendation: "Define identity verification before fulfilling access or deletion requests."
    },
    {
      id: "security_controls",
      dimension: "data_handling_security",
      severity: "high",
      title: "No security safeguards disclosure",
      fail: !includesAny(text, ["security", "safeguards", "encryption", "protect your information"]),
      recommendation: "Describe reasonable security safeguards and operational protections."
    },
    {
      id: "purpose_limitation",
      dimension: "data_handling_security",
      severity: "medium",
      title: "No purpose limitation statement",
      fail: !includesAny(text, ["we use your information to", "purpose of collection", "business purpose"]),
      recommendation: "Tie each collected data category to a specific disclosed purpose."
    },
    {
      id: "third_party_controls",
      dimension: "data_handling_security",
      severity: "medium",
      title: "No third-party/service provider controls",
      fail: !includesAny(text, ["service provider", "data processing", "third party", "contractual safeguards"]),
      recommendation: "State controls and contractual restrictions for third-party data handling."
    },
    {
      id: "sensitive_health_controls",
      dimension: "health_sensitive",
      severity: "high",
      title: "Sensitive health info protections unclear",
      fail:
        includesAny(text, ["medical", "treatment", "health", "wellness"]) &&
        !includesAny(text, ["sensitive personal information", "limit use", "health information privacy"]),
      recommendation: "Apply and disclose stronger controls for sensitive health/treatment-related information."
    }
  ];
}

function weightForSeverity(severity) {
  if (severity === "high") return 1.6;
  if (severity === "medium") return 1.0;
  return 0.7;
}

function scoreDimensions(checks) {
  const dimensions = {};
  for (const check of checks) {
    if (!dimensions[check.dimension]) {
      dimensions[check.dimension] = { totalWeight: 0, failedWeight: 0, totalChecks: 0, failedChecks: 0 };
    }
    const weight = weightForSeverity(check.severity);
    dimensions[check.dimension].totalWeight += weight;
    dimensions[check.dimension].totalChecks += 1;
    if (check.fail) {
      dimensions[check.dimension].failedWeight += weight;
      dimensions[check.dimension].failedChecks += 1;
    }
  }

  const scored = {};
  for (const [key, d] of Object.entries(dimensions)) {
    const ratio = d.totalWeight > 0 ? d.failedWeight / d.totalWeight : 0;
    scored[key] = {
      score: Math.round(ratio * 100),
      failed_checks: d.failedChecks,
      total_checks: d.totalChecks
    };
  }
  return scored;
}

function computeEvidence(text, checks, pagesScannedCount) {
  const keywordHits = [
    "privacy policy",
    "do not sell",
    "global privacy control",
    "notice at collection",
    "cookie",
    "request"
  ].filter((k) => text.includes(k)).length;

  const confidenceBase = text.length >= 9000 ? 2 : text.length >= 2500 ? 1 : 0;
  const pageBonus = pagesScannedCount >= 3 ? 1 : 0;
  const keywordBonus = keywordHits >= 3 ? 1 : 0;
  const confidenceScore = confidenceBase + pageBonus + keywordBonus;
  const confidence = confidenceScore >= 3 ? "high" : confidenceScore >= 2 ? "medium" : "low";

  const passed = checks.filter((c) => !c.fail).length;
  return {
    normalized_text_length: text.length,
    pages_scanned_count: pagesScannedCount,
    check_count: checks.length,
    passed_check_count: passed,
    failed_check_count: checks.length - passed,
    confidence,
    keyword_hits: keywordHits
  };
}

function calculateRisk(checks, evidence, dimensionScores) {
  const totalWeight = checks.reduce((acc, c) => acc + weightForSeverity(c.severity), 0);
  const failedWeight = checks.reduce((acc, c) => acc + (c.fail ? weightForSeverity(c.severity) : 0), 0);
  let score = totalWeight > 0 ? Math.round((failedWeight / totalWeight) * 100) : 0;

  const highSeverityFails = checks.filter((c) => c.fail && c.severity === "high").length;
  const rightsDimension = dimensionScores.consumer_rights?.score || 0;
  const policyDimension = dimensionScores.notice_policy?.score || 0;

  if (evidence.confidence === "low") score = Math.round(score * 0.8);
  if (evidence.confidence === "high") score = Math.round(score * 1.03);

  let label = "green";
  if (score >= 75 || highSeverityFails >= 6 || rightsDimension >= 75 || policyDimension >= 75) {
    label = "red";
  } else if (score >= 40 || highSeverityFails >= 3 || rightsDimension >= 50 || policyDimension >= 50) {
    label = "yellow";
  }

  return { score: Math.min(100, Math.max(0, score)), label };
}

function classifyFailedChecks(checks) {
  return checks
    .filter((check) => check.fail)
    .map((check) => ({
      id: check.id,
      category: check.dimension,
      title: check.title,
      severity: check.severity,
      recommendation: check.recommendation
    }));
}

function injectComplianceOverlay(originalHtml, website, issues) {
  const baseHtml =
    originalHtml && originalHtml.trim()
      ? originalHtml
      : `<!doctype html><html><head><meta charset="utf-8"><title>${website}</title></head><body><main></main></body></html>`;

  const issuesList = issues
    .map((issue) => `<li><strong>${issue.title}:</strong> ${issue.recommendation}</li>`)
    .join("");

  const block = `
<section id="compliancecurrent-ccpa-overlay" style="border:2px solid #0a6ad6;border-radius:12px;padding:20px;margin:24px;background:#f5f9ff;font-family:Arial,sans-serif;">
  <h2 style="margin-top:0;">CCPA Compliance Additions</h2>
  <p><strong>Notice at Collection:</strong> We collect only the data needed to provide services, scheduling, and customer support.</p>
  <p><strong>Consumer Rights:</strong> California consumers can request access, deletion, correction, and opt-out of sale/sharing.</p>
  <p><strong>Do Not Sell or Share:</strong> <a href="/do-not-sell">Do Not Sell or Share My Personal Information</a></p>
  <p><strong>Privacy Requests:</strong> Submit via privacy@yourdomain.com, (555) 000-0000, or our privacy request form.</p>
  <p><strong>Global Privacy Control:</strong> We honor browser-enabled Global Privacy Control signals where required.</p>
  <h3>Detected Risk Fixes</h3>
  <ul>${issuesList}</ul>
  <p style="font-size:12px;color:#5a6778;margin-top:14px;">${LEGAL_DISCLAIMER}</p>
</section>`;

  if (baseHtml.includes("</body>")) {
    return baseHtml.replace("</body>", `${block}\n</body>`);
  }
  return `${baseHtml}\n${block}`;
}

function analyzeCcpaCompliance({ website, html, markdown, pagesScannedCount = 1 }) {
  const normalizedText = normalizeText(`${html || ""} ${markdown || ""}`);
  const checks = buildChecks(normalizedText);
  const dimensionScores = scoreDimensions(checks);
  const evidence = computeEvidence(normalizedText, checks, pagesScannedCount);
  const issues = classifyFailedChecks(checks);
  const risk = calculateRisk(checks, evidence, dimensionScores);
  const remediatedHtml = injectComplianceOverlay(html, website, issues);

  return {
    issues,
    risk,
    evidence,
    dimensionScores,
    remediatedHtml,
    legalDisclaimer: LEGAL_DISCLAIMER
  };
}

module.exports = {
  analyzeCcpaCompliance,
  LEGAL_DISCLAIMER
};
