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
  const optOutDimension = dimensionScores.opt_out_controls?.score || 0;
  const criticalDimension = Math.max(rightsDimension, policyDimension, optOutDimension);

  if (evidence.confidence === "low") score = Math.round(score * 0.8);
  if (evidence.confidence === "high") score = Math.round(score * 1.03);

  let label = "green";
  if (score >= 70 || highSeverityFails >= 7 || (score >= 50 && criticalDimension >= 70)) {
    label = "red";
  } else if (score >= 35 || highSeverityFails >= 3 || criticalDimension >= 50) {
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

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPriorityActionItems(issues) {
  const sorted = [...issues].sort((a, b) => {
    const aScore = a.severity === "high" ? 2 : 1;
    const bScore = b.severity === "high" ? 2 : 1;
    return bScore - aScore;
  });
  return sorted.slice(0, 6);
}

function buildControlStatus(failedIssueIds) {
  const hasFail = (id) => failedIssueIds.has(id);
  return [
    {
      control: "Privacy Policy",
      status: hasFail("privacy_policy_presence") ? "Needs Work" : "Detected",
      notes: "Public privacy policy link and baseline policy language."
    },
    {
      control: "Data Categories + Notice",
      status: hasFail("data_category_disclosure") || hasFail("notice_at_collection") ? "Needs Work" : "Detected",
      notes: "Data categories and notice-at-collection coverage."
    },
    {
      control: "Consumer Rights",
      status: hasFail("ccpa_rights_suite") ? "Needs Work" : "Detected",
      notes: "Know/access, delete, correct, and opt-out rights."
    },
    {
      control: "Do Not Sell/Share + GPC",
      status: hasFail("do_not_sell_link") || hasFail("gpc_support") ? "Needs Work" : "Detected",
      notes: "Opt-out mechanism and Global Privacy Control handling."
    },
    {
      control: "Cookie/Tracking Disclosure",
      status: hasFail("cookie_disclosure") ? "Needs Work" : "Detected",
      notes: "Tracking disclosure and preference management language."
    },
    {
      control: "Request Intake + Verification",
      status: hasFail("request_channels") || hasFail("identity_verification") ? "Needs Work" : "Detected",
      notes: "Two request methods and identity verification process."
    },
    {
      control: "Security + Third-Party Controls",
      status:
        hasFail("security_controls") || hasFail("purpose_limitation") || hasFail("third_party_controls")
          ? "Needs Work"
          : "Detected",
      notes: "Security safeguards, purpose limitation, and provider controls."
    }
  ];
}

function buildOrigin(website) {
  try {
    return new URL(String(website || "").trim()).origin;
  } catch (_error) {
    return null;
  }
}

function isLikelyThirdPartyApiScript(srcUrl, websiteOrigin) {
  const raw = String(srcUrl || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return false;

  let parsed;
  try {
    parsed = websiteOrigin ? new URL(raw, websiteOrigin) : new URL(raw);
  } catch (_error) {
    return false;
  }

  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (websiteOrigin && parsed.origin === websiteOrigin) return false;

  const fullPath = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  const lowerSearch = parsed.search.toLowerCase();
  const hasApiCredentialParam = /[?&](key|api_key|apikey|token|client|signature)=/.test(lowerSearch);

  if (fullPath.includes("maps.googleapis.com/maps/api/js")) return true;
  if (fullPath.includes("maps.googleapis.com/maps-api-v3")) return true;
  if (fullPath.includes("js.stripe.com")) return true;
  if (fullPath.includes("recaptcha")) return true;
  if (fullPath.includes("api.mapbox.com")) return true;
  if (fullPath.includes("connect.facebook.net")) return true;
  if (fullPath.includes("googletagmanager.com")) return true;
  if (fullPath.includes("google-analytics.com")) return true;
  if (fullPath.includes("bat.bing.com")) return true;
  if (fullPath.includes("clarity.ms")) return true;
  if (fullPath.includes("intercom")) return true;
  if (fullPath.includes("zendesk")) return true;
  if (fullPath.includes("hubspot")) return true;

  return hasApiCredentialParam;
}

function stabilizeRemediatedHtml(html, website) {
  const websiteOrigin = buildOrigin(website);
  const disabledScripts = [];

  const rewritten = String(html || "").replace(
    /<script\b([^>]*)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (full, preAttrs, quote, src, postAttrs) => {
      if (!isLikelyThirdPartyApiScript(src, websiteOrigin)) {
        return full;
      }
      disabledScripts.push(src);
      return `<!-- compliancecurrent-disabled-script: ${escapeHtml(src)} -->`;
    }
  );

  return { html: rewritten, disabledScripts };
}

function injectComplianceOverlay(originalHtml, website, issues) {
  const seededHtml =
    originalHtml && originalHtml.trim()
      ? originalHtml
      : `<!doctype html><html><head><meta charset="utf-8"><title>${website}</title></head><body><main></main></body></html>`;
  const stabilized = stabilizeRemediatedHtml(seededHtml, website);
  const baseHtml = stabilized.html;

  const issuesList = issues
    .map((issue) => `<li><strong>${issue.title}:</strong> ${issue.recommendation}</li>`)
    .join("");
  const priorityItems = buildPriorityActionItems(issues)
    .map((issue) => `<li><strong>${issue.title}:</strong> ${issue.recommendation}</li>`)
    .join("");
  const failedIssueIds = new Set(issues.map((issue) => issue.id));
  const controlRows = buildControlStatus(failedIssueIds)
    .map(
      (row) => `<tr>
  <td style="padding:8px;border-bottom:1px solid #e3ecfb;"><strong>${row.control}</strong></td>
  <td style="padding:8px;border-bottom:1px solid #e3ecfb;color:${row.status === "Needs Work" ? "#b54708" : "#047857"};">${row.status}</td>
  <td style="padding:8px;border-bottom:1px solid #e3ecfb;">${row.notes}</td>
</tr>`
    )
    .join("");

  const safeWebsite = escapeHtml(website);
  const disabledScriptsList = stabilized.disabledScripts
    .slice(0, 12)
    .map((src) => `<li><code>${escapeHtml(src)}</code></li>`)
    .join("");
  const disabledScriptsNote = stabilized.disabledScripts.length
    ? `<section id="ccpa-download-compatibility" style="background:#fff8e8;border:1px solid #f7d9a3;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Download Compatibility Notes</h3>
    <p style="margin:0 0 8px;">To keep this downloadable remediation package stable across unknown hosting environments, some third-party API/tracking scripts were disabled in this exported file.</p>
    <ul style="margin:0 0 8px;padding-left:20px;">${disabledScriptsList}</ul>
    <p style="margin:0;">If your production site needs those integrations, re-enable them in your main codebase after validating API keys and embedding method requirements.</p>
  </section>`
    : "";

  const block = `
<section id="compliancecurrent-ccpa-overlay" style="border:2px solid #0a6ad6;border-radius:12px;padding:20px;margin:24px;background:#f5f9ff;font-family:Arial,sans-serif;line-height:1.5;color:#102138;">
  <h2 style="margin-top:0;">ComplianceCurrent CCPA Protection Pack</h2>
  <p style="margin:0 0 10px;">Generated for: <strong>${safeWebsite}</strong></p>
  <p style="margin:0 0 16px;">This package adds the baseline controls typically required for California CCPA/CPRA disclosures and request handling.</p>

  <nav aria-label="CCPA quick links" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;">
    <a href="#ccpa-notice-at-collection" style="background:#e7f0ff;padding:6px 10px;border-radius:999px;text-decoration:none;color:#0a57b8;">Notice at Collection</a>
    <a href="#ccpa-privacy-policy" style="background:#e7f0ff;padding:6px 10px;border-radius:999px;text-decoration:none;color:#0a57b8;">Privacy Policy</a>
    <a href="#ccpa-do-not-sell" style="background:#e7f0ff;padding:6px 10px;border-radius:999px;text-decoration:none;color:#0a57b8;">Do Not Sell/Share</a>
    <a href="#ccpa-cookie-disclosure" style="background:#e7f0ff;padding:6px 10px;border-radius:999px;text-decoration:none;color:#0a57b8;">Cookie Disclosure</a>
    <a href="#ccpa-privacy-request" style="background:#e7f0ff;padding:6px 10px;border-radius:999px;text-decoration:none;color:#0a57b8;">Privacy Requests</a>
  </nav>

  <section id="ccpa-notice-at-collection" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Notice at Collection</h3>
    <p style="margin:0;">At or before collection, we disclose that we collect identifiers, contact details, booking/treatment preferences, payment-adjacent transaction data, device/network data, and website interaction data for scheduling, service delivery, customer support, security, analytics, and legal compliance.</p>
  </section>

  <section id="ccpa-privacy-policy" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Privacy Policy Language (CCPA)</h3>
    <p style="margin:0 0 8px;">California consumers have the right to know/access, delete, correct, and opt out of sale/sharing of personal information, and to limit certain uses of sensitive personal information where applicable. We do not discriminate against users for exercising privacy rights.</p>
    <p style="margin:0;">We retain personal information only as long as reasonably necessary for disclosed business purposes and legal obligations, and we implement reasonable administrative, technical, and physical safeguards.</p>
  </section>

  <section id="ccpa-do-not-sell" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Do Not Sell or Share My Personal Information</h3>
    <p style="margin:0 0 8px;">Provide a clear and conspicuous mechanism for California residents to opt out of sale/sharing.</p>
    <p style="margin:0 0 8px;"><a href="#ccpa-privacy-request" style="color:#0a57b8;font-weight:600;">Do Not Sell or Share My Personal Information</a></p>
    <p style="margin:0;">Global Privacy Control (GPC) signals should be treated as valid opt-out requests where required.</p>
  </section>

  <section id="ccpa-cookie-disclosure" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Cookie and Tracking Disclosure</h3>
    <p style="margin:0 0 8px;">We use cookies and similar technologies for essential site operation, analytics, and advertising. Users can manage preferences and opt out of non-essential tracking and sharing where applicable.</p>
    <p style="margin:0;">If ad-tech cookies are used, they must be disabled after an opt-out request is received.</p>
  </section>

  <section id="ccpa-privacy-request" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Privacy Request Methods and Verification</h3>
    <ul style="margin:0;padding-left:20px;">
      <li>Email: <a href="mailto:privacy@yourdomain.com">privacy@yourdomain.com</a></li>
      <li>Phone: (555) 000-0000</li>
      <li>Web form: /privacy-request endpoint/page</li>
    </ul>
    <p style="margin:8px 0 0;">Before fulfilling access/deletion/correction requests, verify requestor identity with a reasonable, risk-based process and support authorized-agent requests.</p>
  </section>

  <section id="ccpa-service-provider-controls" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Service Provider and Sensitive Data Controls</h3>
    <p style="margin:0 0 8px;">Use written contracts restricting service providers from retaining, using, or disclosing personal information outside contracted business purposes.</p>
    <p style="margin:0;">For health/treatment-related information, apply heightened handling controls and clearly disclose those protections.</p>
  </section>

  <section id="ccpa-detected-risk-fixes" style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Priority Actions (First 7 Days)</h3>
    <ul style="margin:0 0 12px;padding-left:20px;">${priorityItems || "<li>No urgent actions identified from current scan.</li>"}</ul>
    <h3 style="margin:0 0 8px;">CCPA Control Status</h3>
    <div style="overflow:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #cfe0ff;">Control</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #cfe0ff;">Status</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #cfe0ff;">Notes</th>
          </tr>
        </thead>
        <tbody>${controlRows}</tbody>
      </table>
    </div>
    <h3 style="margin:0 0 8px;">Detected Risk Fixes</h3>
    <ul style="margin:0;padding-left:20px;">${issuesList}</ul>
  </section>
  ${disabledScriptsNote}

  <p style="font-size:12px;color:#5a6778;margin:8px 0 0;">${LEGAL_DISCLAIMER}</p>
</section>
<script>
(function(){
  function injectNotices() {
    try {
      var rootStyle = window.getComputedStyle(document.documentElement);
      var bodyStyle = window.getComputedStyle(document.body || document.documentElement);
      var sampleButton = document.querySelector(".btn, button, [role='button'], a");
      var sampleButtonStyle = sampleButton ? window.getComputedStyle(sampleButton) : null;
      var primary = (rootStyle.getPropertyValue("--primary") || "").trim() || (sampleButtonStyle && sampleButtonStyle.backgroundColor) || (sampleButtonStyle && sampleButtonStyle.color) || "#2563eb";
      var surface = (rootStyle.getPropertyValue("--card") || "").trim() || bodyStyle.backgroundColor || "#ffffff";
      var text = (rootStyle.getPropertyValue("--text") || "").trim() || bodyStyle.color || "#0f172a";
      var border = (rootStyle.getPropertyValue("--line") || "").trim() || primary;
      var font = bodyStyle.fontFamily || "Arial, sans-serif";
      var forms = document.querySelectorAll("form");
      if (!forms || !forms.length) return;

      forms.forEach(function(form) {
        if (!form || form.closest("#compliancecurrent-ccpa-overlay")) return;
        if (form.dataset.ccpaNoticeInjected === "true") return;
        if (form.querySelector(".ccpa-form-notice")) {
          form.dataset.ccpaNoticeInjected = "true";
          return;
        }

        var notice = document.createElement("div");
        notice.className = "ccpa-form-notice";
        notice.style.cssText =
          "margin:0 0 10px;padding:9px 11px;border:1px solid " + border + ";border-radius:8px;" +
          "background:" + surface + ";color:" + text + ";font-size:12.5px;line-height:1.4;font-family:" + font + ";";
        notice.innerHTML =
          "Notice at collection: We collect details from this form to provide requested services and compliance support. " +
          "<a href='/privacy-policy' style='color:" + primary + ";font-weight:600;'>Privacy Policy</a> · " +
          "<a href='/do-not-sell' style='color:" + primary + ";font-weight:600;'>Do Not Sell/Share</a>";

        var submitTarget = form.querySelector("button[type='submit'], input[type='submit']");
        if (submitTarget && submitTarget.parentNode) {
          submitTarget.parentNode.insertBefore(notice, submitTarget);
        } else {
          form.appendChild(notice);
        }

        form.dataset.ccpaNoticeInjected = "true";
      });
    } catch (_e) {}
  }

  try {
    if (document.getElementById("ccpa-cookie-banner")) return;
    var key = "ccpa_cookie_pref";
    if (localStorage.getItem(key)) return;
    if (navigator.globalPrivacyControl === true) {
      localStorage.setItem(key, "essential_only");
      return;
    }

    var rootStyle = window.getComputedStyle(document.documentElement);
    var bodyStyle = window.getComputedStyle(document.body || document.documentElement);
    var sampleButton = document.querySelector(".btn, button, [role='button'], a");
    var sampleButtonStyle = sampleButton ? window.getComputedStyle(sampleButton) : null;
    var primary = (rootStyle.getPropertyValue("--primary") || "").trim() || (sampleButtonStyle && sampleButtonStyle.backgroundColor) || (sampleButtonStyle && sampleButtonStyle.color) || "#2563eb";
    var surface = (rootStyle.getPropertyValue("--card") || "").trim() || bodyStyle.backgroundColor || "#ffffff";
    var text = (rootStyle.getPropertyValue("--text") || "").trim() || bodyStyle.color || "#0f172a";
    var border = (rootStyle.getPropertyValue("--line") || "").trim() || primary;
    var font = bodyStyle.fontFamily || "Arial, sans-serif";
    var mobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    var inset = mobile ? "10px" : "16px";

    var banner = document.createElement("aside");
    banner.id = "ccpa-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie preferences");
    banner.style.cssText = "position:fixed;left:" + inset + ";right:" + inset + ";bottom:" + inset + ";z-index:99999;background:" + surface + ";color:" + text + ";border:1px solid " + border + ";border-radius:12px;padding:12px;box-shadow:0 14px 30px rgba(0,0,0,.2);font-family:" + font + ";";
    banner.innerHTML = '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">'
      + '<div style="font-size:13.5px;line-height:1.35;max-width:780px;flex:1 1 360px;">We use cookies and similar technologies for site operations, analytics, and sharing preferences. <a href="/cookie-policy" style="color:' + primary + ';font-weight:600;text-decoration:underline;">Cookie Policy</a></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button id="ccpa-cookies-essential" style="border:1px solid ' + border + ';background:transparent;color:' + text + ';border-radius:8px;padding:7px 11px;cursor:pointer;font-size:13px;font-weight:600;">Essential Only</button>'
      + '<button id="ccpa-cookies-accept" style="border:none;background:' + primary + ';color:#fff;border-radius:8px;padding:7px 11px;cursor:pointer;font-size:13px;font-weight:700;">Allow All</button>'
      + '</div></div>';
    document.body.appendChild(banner);

    var close = function(value){
      try { localStorage.setItem(key, value); } catch(e) {}
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    };
    document.getElementById("ccpa-cookies-essential").addEventListener("click", function(){ close("essential_only"); });
    document.getElementById("ccpa-cookies-accept").addEventListener("click", function(){ close("accept_all"); });
  } catch (_e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectNotices);
  } else {
    injectNotices();
  }
  setTimeout(injectNotices, 1500);
})();
</script>`;

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
