const { LEGAL_DISCLAIMER } = require("./ccpa");

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function collectScriptSources(html) {
  const out = [];
  const regex = /<script\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    out.push(match[2]);
  }
  return unique(out);
}

function collectFormActions(html, website) {
  const out = [];
  const regex = /<form\b[^>]*\baction=(['"])([^'"]+)\1[^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      out.push(new URL(match[2], website).toString());
    } catch (_e) {
      out.push(match[2]);
    }
  }
  return unique(out);
}

function collectApiEndpoints(html, website) {
  const out = [];
  const endpointRegexes = [
    /fetch\((['"])([^'"]+)\1/gi,
    /axios\.(?:get|post|put|patch|delete)\((['"])([^'"]+)\1/gi,
    /\$\.ajax\(\{[^}]*url:\s*(['"])([^'"]+)\1/gi,
    /XMLHttpRequest\([^)]*\)[\s\S]{0,180}?open\((['"])[A-Z]+\1,\s*(['"])([^'"]+)\2/gi
  ];

  endpointRegexes.forEach((regex) => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const value = match[3] || match[2] || "";
      if (!value) continue;
      try {
        out.push(new URL(value, website).toString());
      } catch (_e) {
        out.push(value);
      }
    }
  });

  return unique(out);
}

function detectVendors(scriptSources) {
  const catalog = [
    { id: "google_maps", pattern: /maps\.googleapis\.com/i, label: "Google Maps" },
    { id: "google_tag_manager", pattern: /googletagmanager\.com/i, label: "Google Tag Manager" },
    { id: "google_analytics", pattern: /google-analytics\.com|gtag\/js/i, label: "Google Analytics" },
    { id: "stripe", pattern: /js\.stripe\.com/i, label: "Stripe" },
    { id: "meta_pixel", pattern: /connect\.facebook\.net/i, label: "Meta Pixel" },
    { id: "hubspot", pattern: /hubspot\.com/i, label: "HubSpot" },
    { id: "intercom", pattern: /intercom/i, label: "Intercom" },
    { id: "zendesk", pattern: /zendesk/i, label: "Zendesk" },
    { id: "mapbox", pattern: /api\.mapbox\.com/i, label: "Mapbox" },
    { id: "recaptcha", pattern: /recaptcha/i, label: "Google reCAPTCHA" }
  ];

  return catalog
    .filter((vendor) => scriptSources.some((src) => vendor.pattern.test(src)))
    .map((vendor) => vendor.label);
}

function detectBackendSignals(html) {
  const checks = [
    { label: "Next.js", pattern: /__NEXT_DATA__|_next\//i },
    { label: "WordPress", pattern: /wp-content|wp-includes|wp-json/i },
    { label: "Shopify", pattern: /cdn\.shopify\.com|shopify/i },
    { label: "GraphQL", pattern: /graphql/i },
    { label: "REST APIs", pattern: /\/api\//i },
    { label: "Firebase", pattern: /firebase/i }
  ];
  return checks.filter((c) => c.pattern.test(html)).map((c) => c.label);
}

function buildIntegrationAnalysis({ html, website }) {
  const scriptSources = collectScriptSources(html);
  const formActions = collectFormActions(html, website);
  const apiEndpoints = collectApiEndpoints(html, website);
  const vendors = detectVendors(scriptSources);
  const backendSignals = detectBackendSignals(html);

  return {
    script_count: scriptSources.length,
    detected_vendors: vendors,
    backend_signals: backendSignals,
    api_endpoints: apiEndpoints.slice(0, 50),
    form_actions: formActions.slice(0, 25),
    preservation_strategy:
      "Preserve all existing scripts/forms/endpoints and add compliance modules as additive sections only."
  };
}

function issueListMarkup(issues) {
  if (!issues || !issues.length) {
    return "<li>No high-priority issues detected from current scan.</li>";
  }

  return issues
    .slice(0, 20)
    .map(
      (issue) =>
        `<li><strong>${escapeHtml(issue.title || "Issue")}</strong>: ${escapeHtml(
          issue.recommendation || "Apply a CCPA-aligned disclosure/control update."
        )}</li>`
    )
    .join("");
}

function vendorMarkup(vendors) {
  if (!vendors.length) return "<li>No major third-party client-side vendors detected.</li>";
  return vendors.map((vendor) => `<li>${escapeHtml(vendor)}</li>`).join("");
}

function endpointMarkup(endpoints) {
  if (!endpoints.length) return "<li>No API endpoints were automatically detected from static HTML/JS.</li>";
  return endpoints.slice(0, 12).map((endpoint) => `<li><code>${escapeHtml(endpoint)}</code></li>`).join("");
}

function formActionMarkup(actions) {
  if (!actions.length) return "<li>No explicit form action attributes were detected.</li>";
  return actions.slice(0, 10).map((action) => `<li><code>${escapeHtml(action)}</code></li>`).join("");
}

function isHexColor(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function normalizeHex(value) {
  const color = String(value || "").trim();
  if (!isHexColor(color)) return "";
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase();
  }
  return color.toLowerCase();
}

function hexToRgb(hex) {
  const c = normalizeHex(hex);
  if (!c) return null;
  return {
    r: parseInt(c.slice(1, 3), 16),
    g: parseInt(c.slice(3, 5), 16),
    b: parseInt(c.slice(5, 7), 16)
  };
}

function isLikelyGray(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return Math.abs(rgb.r - rgb.g) < 10 && Math.abs(rgb.g - rgb.b) < 10 && Math.abs(rgb.r - rgb.b) < 10;
}

function isDark(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance < 0.5;
}

function firstHexByPreference(candidates, terms) {
  const lower = candidates.map((c) => ({ key: c.key.toLowerCase(), value: normalizeHex(c.value) })).filter((x) => x.value);
  for (const term of terms) {
    const hit = lower.find((item) => item.key.includes(term));
    if (hit) return hit.value;
  }
  return "";
}

function extractThemeTokens(html) {
  const styleBlocks = [];
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styleBlocks.push(match[1] || "");
  }
  const styleText = styleBlocks.join("\n");

  const cssVarPairs = [];
  const varRegex = /--([\w-]+)\s*:\s*([^;]+);/gi;
  while ((match = varRegex.exec(styleText)) !== null) {
    cssVarPairs.push({ key: match[1], value: match[2].trim() });
  }

  const hexPalette = unique(
    (styleText.match(/#[0-9a-f]{3,6}\b/gi) || [])
      .map((c) => normalizeHex(c))
      .filter(Boolean)
  );

  const fontCandidates = [];
  const fontRegex = /font-family\s*:\s*([^;}{]+)[;}]?/gi;
  while ((match = fontRegex.exec(styleText)) !== null) {
    fontCandidates.push(match[1].trim());
  }

  const primaryFromVars = firstHexByPreference(cssVarPairs, ["primary", "accent", "brand"]);
  const textFromVars = firstHexByPreference(cssVarPairs, ["text", "foreground", "font"]);
  const bgFromVars = firstHexByPreference(cssVarPairs, ["background", "bg", "surface"]);
  const borderFromVars = firstHexByPreference(cssVarPairs, ["border", "line", "stroke"]);

  const colorful = hexPalette.filter((hex) => !isLikelyGray(hex));
  const grayscale = hexPalette.filter((hex) => isLikelyGray(hex));

  const primary = primaryFromVars || colorful[0] || "#0a6ad6";
  const surface = bgFromVars || grayscale.find((hex) => !isDark(hex)) || "#ffffff";
  const panel = grayscale.find((hex) => !isDark(hex) && hex !== surface) || "#f7f9fd";
  const border = borderFromVars || grayscale.find((hex) => isDark(hex)) || "#d3ddeb";
  const text = textFromVars || (isDark(surface) ? "#f7f9ff" : "#132238");
  const muted = isDark(surface) ? "#d3ddeb" : "#556377";
  const font = fontCandidates[0] || "Arial, sans-serif";

  return {
    primary,
    surface,
    panel,
    border,
    text,
    muted,
    font
  };
}

function buildCompactCookieBannerScript(theme) {
  return `<script>
(function(){
  try {
    var prefKey = "ccpa_cookie_pref";
    if (document.getElementById("ccpa-cookie-banner")) return;
    if (localStorage.getItem(prefKey)) return;
    if (navigator.globalPrivacyControl === true) {
      localStorage.setItem(prefKey, "essential_only");
      return;
    }

    var mobile = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    var inset = mobile ? "10px" : "16px";
    var banner = document.createElement("aside");
    banner.id = "ccpa-cookie-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Cookie preferences");
    banner.style.cssText =
      "position:fixed;left:" + inset + ";right:" + inset + ";bottom:" + inset + ";z-index:99999;" +
      "background:${theme.panel};color:${theme.text};border:1px solid ${theme.border};border-radius:12px;" +
      "padding:12px;box-shadow:0 14px 30px rgba(0,0,0,.2);";

    banner.innerHTML =
      '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
        '<div style="line-height:1.35;max-width:780px;flex:1 1 360px;">' +
          'We use cookies and similar technologies for site operations, analytics, and sharing preferences. ' +
          '<a href="/cookie-policy" style="color:${theme.primary};font-weight:600;text-decoration:underline;">Cookie Policy</a>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button id="ccpa-cookies-essential" style="border:1px solid ${theme.border};background:transparent;color:${theme.text};border-radius:8px;padding:7px 11px;font-weight:600;cursor:pointer;">Essential Only</button>' +
          '<button id="ccpa-cookies-accept" style="border:none;background:${theme.primary};color:#ffffff;border-radius:8px;padding:7px 11px;font-weight:700;cursor:pointer;">Allow All</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(banner);

    var close = function(value) {
      try { localStorage.setItem(prefKey, value); } catch (_e) {}
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    };

    document.getElementById("ccpa-cookies-essential").addEventListener("click", function(){ close("essential_only"); });
    document.getElementById("ccpa-cookies-accept").addEventListener("click", function(){ close("accept_all"); });
  } catch (_e) {}
})();
</script>`;
}

function buildMultiFormNoticeScript(theme) {
  return `<script>
(function(){
  function injectNotices() {
    try {
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
          "margin:0 0 10px;padding:9px 11px;border:1px solid ${theme.border};border-radius:8px;" +
          "background:${theme.surface};color:${theme.text};line-height:1.4;";
        notice.innerHTML =
          "Notice at collection: We collect details from this form to provide lending, investment, and customer support services. " +
          "<a href='/privacy-policy' style='color:${theme.primary};font-weight:600;'>Privacy Policy</a> · " +
          "<a href='/do-not-sell' style='color:${theme.primary};font-weight:600;'>Do Not Sell/Share</a>";

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectNotices);
  } else {
    injectNotices();
  }

  setTimeout(injectNotices, 1500);
})();
</script>`;
}

function buildFooterLinksScript(theme) {
  return `<script>
(function(){
  try {
    if (document.getElementById("ccpa-inline-legal-links")) return;
    var footerTarget = document.querySelector("footer, #footer, #main-footer, .site-footer, .footer, [role='contentinfo']");
    if (!footerTarget) return;
    var box = document.createElement("div");
    box.id = "ccpa-inline-legal-links";
    box.style.cssText =
      "margin:14px 0 0;padding:10px 12px;border:1px solid ${theme.border};border-radius:8px;" +
      "background:${theme.surface};color:${theme.text};line-height:1.4;";
    box.innerHTML =
      "<strong style='font-weight:600;'>California Real Estate Privacy Controls</strong> " +
      "<a href='/privacy-policy' style='color:${theme.primary};font-weight:600;margin-left:8px;'>Privacy Policy</a> · " +
      "<a href='/do-not-sell' style='color:${theme.primary};font-weight:600;'>Do Not Sell/Share</a> · " +
      "<a href='/privacy-request' style='color:${theme.primary};font-weight:600;'>Privacy Requests</a>";
    footerTarget.appendChild(box);
  } catch (_e) {}
})();
</script>`;
}

function buildComplianceSection({ website, issues, analysis, generatedAt, theme }) {
  const cookieBannerScript = buildCompactCookieBannerScript(theme);
  const multiFormNoticeScript = buildMultiFormNoticeScript(theme);
  const footerLinksScript = buildFooterLinksScript(theme);
  return `
${cookieBannerScript}
${multiFormNoticeScript}
${footerLinksScript}
<!-- compliancecurrent-remediation-mode: integrated-inline -->
<!-- compliancecurrent-generated-for: ${escapeHtml(website)} -->
<!-- compliancecurrent-generated-at: ${escapeHtml(generatedAt)} -->
<!-- compliancecurrent-risk-highlights: ${escapeHtml((issues || []).slice(0, 6).map((issue) => issue.title).join(" | "))} -->
<!-- compliancecurrent-disclaimer: ${escapeHtml(LEGAL_DISCLAIMER)} -->`;
}

function injectComplianceSection(html, sectionMarkup) {
  const base = String(html || "").trim() || "<!doctype html><html><head><meta charset=\"utf-8\"><title>Remediated Site</title></head><body></body></html>";
  if (base.includes("</body>")) {
    return base.replace("</body>", `${sectionMarkup}\n</body>`);
  }
  return `${base}\n${sectionMarkup}`;
}

function generatePaidRemediation({ website, html, issues }) {
  const sourceHtml = String(html || "");
  const analysis = buildIntegrationAnalysis({ html: sourceHtml, website });
  const theme = extractThemeTokens(sourceHtml);
  const sectionMarkup = buildComplianceSection({
    website,
    issues: Array.isArray(issues) ? issues : [],
    analysis,
    generatedAt: new Date().toISOString(),
    theme
  });

  return {
    remediatedHtml: injectComplianceSection(sourceHtml, sectionMarkup),
    analysis: {
      ...analysis,
      adaptive_theme: theme
    }
  };
}

module.exports = {
  generatePaidRemediation
};
