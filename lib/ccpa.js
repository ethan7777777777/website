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
      recommendation: "Add notice-at-collection language for inquiry, contact, and request workflows."
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
      id: "sensitive_financial_controls",
      dimension: "financial_sensitive",
      severity: "high",
      title: "Sensitive financial information protections unclear",
      fail:
        includesAny(text, ["loan", "mortgage", "credit", "financial", "investor", "trust deed"]) &&
        !includesAny(text, ["sensitive personal information", "limit use", "financial information safeguards", "glba"]),
      recommendation: "Apply and disclose stronger controls for sensitive financial and account-related information."
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
  const block = `
<script>
(function(){
  function toRgb(value) {
    var raw = String(value || "").trim();
    if (!raw) return null;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
      var hex = raw.length === 4
        ? "#" + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3]
        : raw;
      return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
      };
    }
    var rgbMatch = raw.match(/rgba?\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
    if (rgbMatch) {
      return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
    }
    return null;
  }

  function relLuminance(rgb) {
    var toLinear = function(v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  }

  function contrastRatio(c1, c2) {
    var rgb1 = toRgb(c1);
    var rgb2 = toRgb(c2);
    if (!rgb1 || !rgb2) return 1;
    var l1 = relLuminance(rgb1);
    var l2 = relLuminance(rgb2);
    var lighter = Math.max(l1, l2);
    var darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function pickText(bg) {
    return contrastRatio(bg, "#0f172a") >= 4.5 ? "#0f172a" : "#f8fafc";
  }

  function injectFooterLinks(primary, text, surface, border) {
    try {
      if (document.getElementById("ccpa-inline-legal-links")) return;
      var footerTarget = document.querySelector("footer, #footer, #main-footer, .site-footer, .footer, [role='contentinfo']");
      if (!footerTarget) return;
      var box = document.createElement("div");
      box.id = "ccpa-inline-legal-links";
      box.style.cssText =
        "margin:14px 0 0;padding:10px 12px;border:1px solid " + border + ";border-radius:8px;" +
        "background:" + surface + ";color:" + text + ";line-height:1.4;";
      box.innerHTML =
        "<strong style='font-weight:600;'>California Real Estate Privacy Controls</strong> " +
        "<a href='/privacy-policy' style='color:" + primary + ";font-weight:600;margin-left:8px;'>Privacy Policy</a> · " +
        "<a href='/do-not-sell' style='color:" + primary + ";font-weight:600;'>Do Not Sell/Share</a> · " +
        "<a href='/privacy-request' style='color:" + primary + ";font-weight:600;'>Privacy Requests</a>";
      footerTarget.appendChild(box);
    } catch (_e) {}
  }

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
      if (contrastRatio(surface, text) < 4.5) {
        text = pickText(surface);
      }
      var forms = document.querySelectorAll("form");
      if (!forms || !forms.length) return;

      forms.forEach(function(form) {
        if (!form) return;
        if (form.dataset.ccpaNoticeInjected === "true") return;
        if (form.querySelector(".ccpa-form-notice")) {
          form.dataset.ccpaNoticeInjected = "true";
          return;
        }

        var notice = document.createElement("div");
        notice.className = "ccpa-form-notice";
        notice.style.cssText =
          "margin:0 0 10px;padding:9px 11px;border:1px solid " + border + ";border-radius:8px;" +
          "background:" + surface + ";color:" + text + ";line-height:1.4;";
        notice.innerHTML =
          "Notice at collection: We collect details from this form to provide lending, investment, and customer support services. " +
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

      injectFooterLinks(primary, text, surface, border);
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
    if (contrastRatio(surface, text) < 4.5) {
      text = pickText(surface);
    }
    if (contrastRatio(primary, "#ffffff") < 4.5) {
      primary = "#2563eb";
    }
    var mobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    var inset = mobile ? "10px" : "16px";

    var banner = document.createElement("aside");
    banner.id = "ccpa-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie preferences");
    banner.style.cssText = "position:fixed;left:" + inset + ";right:" + inset + ";bottom:" + inset + ";z-index:99999;background:" + surface + ";color:" + text + ";border:1px solid " + border + ";border-radius:12px;padding:12px;box-shadow:0 14px 30px rgba(0,0,0,.2);";
    banner.innerHTML = '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">'
      + '<div style="line-height:1.35;max-width:780px;flex:1 1 360px;">We use cookies and similar technologies for site operations, analytics, and sharing preferences. <a href="/cookie-policy" style="color:' + primary + ';font-weight:600;text-decoration:underline;">Cookie Policy</a></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button id="ccpa-cookies-essential" style="border:1px solid ' + border + ';background:transparent;color:' + text + ';border-radius:8px;padding:7px 11px;cursor:pointer;font-weight:600;">Essential Only</button>'
      + '<button id="ccpa-cookies-accept" style="border:none;background:' + primary + ';color:#fff;border-radius:8px;padding:7px 11px;cursor:pointer;font-weight:700;">Allow All</button>'
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
</script>
<!-- compliancecurrent-remediation-mode: integrated-inline -->
<!-- compliancecurrent-disabled-scripts: ${escapeHtml(stabilized.disabledScripts.join(", "))} -->
<!-- compliancecurrent-disclaimer: ${escapeHtml(LEGAL_DISCLAIMER)} -->`;

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
