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
  return [
    {
      id: "privacy_policy_missing",
      category: "Privacy Policy & Notice Failures",
      title: "Missing or outdated Privacy Policy",
      fail: !includesAny(text, ["privacy policy", "privacy notice"]),
      severity: "high",
      recommendation: "Publish a comprehensive privacy policy listing categories collected, use, and sharing/sale details."
    },
    {
      id: "ccpa_rights_missing",
      category: "Privacy Policy & Notice Failures",
      title: "Failing to list CCPA rights",
      fail:
        !(
          includesAny(text, ["right to know", "right to delete", "right to access", "right to correct", "california residents have the right"]) &&
          includesAny(text, ["opt-out", "do not sell", "do not share"])
        ),
      severity: "high",
      recommendation:
        "Add consumer rights disclosures covering know, access, delete, correct, and opt-out rights for California residents."
    },
    {
      id: "notice_at_collection_missing",
      category: "Privacy Policy & Notice Failures",
      title: "Lack of Notice at Collection",
      fail: !includesAny(text, ["notice at collection", "categories of personal information we collect"]),
      severity: "high",
      recommendation: "Display a notice at or before collection that states what information is collected and why."
    },
    {
      id: "dnsmi_missing",
      category: "User Rights & Opt-Out Violations",
      title: "No Do Not Sell or Share link",
      fail: !includesAny(text, ["do not sell", "do not share my personal information"]),
      severity: "high",
      recommendation: "Add a clear and conspicuous Do Not Sell or Share My Personal Information link."
    },
    {
      id: "gpc_missing",
      category: "User Rights & Opt-Out Violations",
      title: "Ignoring Global Privacy Control",
      fail: !includesAny(text, ["global privacy control", "gpc"]),
      severity: "medium",
      recommendation: "Document and honor browser-based Global Privacy Control signals."
    },
    {
      id: "cookie_optout_missing",
      category: "User Rights & Opt-Out Violations",
      title: "Misconfigured cookie consent and opt-out handling",
      fail: !includesAny(text, ["cookie", "tracking", "consent preferences", "manage cookies"]),
      severity: "medium",
      recommendation: "Ensure tracking for targeted advertising stops after opt-out and is documented."
    },
    {
      id: "request_methods_missing",
      category: "User Rights & Opt-Out Violations",
      title: "Insufficient methods for access/deletion requests",
      fail:
        !(
          (text.includes("email") || text.includes("@")) &&
          (text.includes("phone") || text.includes("call")) &&
          includesAny(text, ["request form", "submit request", "contact form", "privacy request"])
        ),
      severity: "medium",
      recommendation: "Provide at least two clear request methods (email, phone, web form) for privacy rights."
    },
    {
      id: "sale_without_optout",
      category: "Data Sharing & Security Issues",
      title: "Selling or sharing data without consent pathway",
      fail: includesAny(text, ["share with partners", "advertising partners"]) && !includesAny(text, ["do not sell", "opt-out"]),
      severity: "high",
      recommendation: "Add explicit opt-out mechanisms before any sale/share of personal information."
    },
    {
      id: "purpose_limitation_missing",
      category: "Data Sharing & Security Issues",
      title: "Violating purpose limitation principle",
      fail: !includesAny(text, ["we use your information to", "purpose of collection", "business purpose"]),
      severity: "medium",
      recommendation: "Tie each data category to a disclosed business purpose in policy language."
    },
    {
      id: "third_party_contracts_missing",
      category: "Data Sharing & Security Issues",
      title: "Unsafe third-party contracts",
      fail: !includesAny(text, ["service provider", "contract", "data processing agreement"]),
      severity: "medium",
      recommendation: "Use written provider contracts limiting use of personal data to approved services."
    },
    {
      id: "security_disclosure_missing",
      category: "Data Sharing & Security Issues",
      title: "Neglecting data security procedures",
      fail: !includesAny(text, ["security", "protect", "safeguard", "encryption"]),
      severity: "high",
      recommendation: "Publish and implement reasonable security safeguards and access controls."
    },
    {
      id: "sensitive_health_handling_missing",
      category: "Specific Risks for Health/Spa Websites",
      title: "Treating sensitive health data as regular data",
      fail: includesAny(text, ["medical", "treatment", "health"]) && !includesAny(text, ["sensitive personal information", "limit use"]),
      severity: "high",
      recommendation: "Classify treatment/health-related inputs as sensitive and apply stricter handling controls."
    },
    {
      id: "identity_verification_missing",
      category: "Specific Risks for Health/Spa Websites",
      title: "Failure to verify identity for requests",
      fail: !includesAny(text, ["verify your identity", "identity verification", "authorized agent"]),
      severity: "medium",
      recommendation: "Add an identity verification process before fulfilling access/deletion requests."
    }
  ];
}

function calculateRisk(checks) {
  const weightFor = (severity) => (severity === "high" ? 10 : 6);
  const weightedFailed = checks.reduce((acc, check) => {
    if (!check.fail) {
      return acc;
    }
    return acc + weightFor(check.severity);
  }, 0);
  const weightedPossible = checks.reduce((acc, check) => acc + weightFor(check.severity), 0);
  const score = weightedPossible > 0 ? Math.round((weightedFailed / weightedPossible) * 100) : 0;
  const boundedScore = Math.min(100, Math.max(0, score));
  const highFailures = checks.filter((check) => check.fail && check.severity === "high").length;
  const label =
    boundedScore >= 70 || highFailures >= 5
      ? "red"
      : boundedScore >= 35 || highFailures >= 2
        ? "yellow"
        : "green";

  return { score: boundedScore, label };
}

function buildEvidence(normalizedText, checks) {
  const passedChecks = checks.filter((check) => !check.fail).length;
  const failedChecks = checks.length - passedChecks;
  const confidence =
    normalizedText.length >= 3000 ? "high" : normalizedText.length >= 1200 ? "medium" : "low";

  return {
    normalized_text_length: normalizedText.length,
    check_count: checks.length,
    passed_check_count: passedChecks,
    failed_check_count: failedChecks,
    confidence
  };
}

function classifyFailedChecks(checks) {
  return checks
    .filter((check) => check.fail)
    .map((check) => ({
      id: check.id,
      category: check.category,
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

function analyzeCcpaCompliance({ website, html, markdown }) {
  const normalizedText = normalizeText(`${html || ""} ${markdown || ""}`);
  const checks = buildChecks(normalizedText);
  const issues = classifyFailedChecks(checks);
  const risk = calculateRisk(checks);
  const evidence = buildEvidence(normalizedText, checks);
  const remediatedHtml = injectComplianceOverlay(html, website, issues);

  return {
    issues,
    risk,
    evidence,
    remediatedHtml,
    legalDisclaimer: LEGAL_DISCLAIMER
  };
}

module.exports = {
  analyzeCcpaCompliance,
  LEGAL_DISCLAIMER
};
