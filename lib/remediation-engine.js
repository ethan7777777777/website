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

function buildComplianceSection({ website, issues, analysis, generatedAt }) {
  return `
<section id="compliancecurrent-remediation-pack" style="border:2px solid #0a6ad6;border-radius:12px;padding:20px;margin:24px;background:#f5f9ff;font-family:Arial,sans-serif;line-height:1.5;color:#102138;">
  <h2 style="margin-top:0;">ComplianceCurrent Remediation Pack</h2>
  <p style="margin:0 0 6px;">Generated for: <strong>${escapeHtml(website)}</strong></p>
  <p style="margin:0 0 16px;">Generated at: ${escapeHtml(generatedAt)}</p>

  <section style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Notice at Collection</h3>
    <p style="margin:0;">We collect identifiers, contact details, booking preferences, transaction-adjacent information, device/network data, and site interaction data to provide services, improve operations, secure systems, and comply with law.</p>
  </section>

  <section style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">California Consumer Rights</h3>
    <p style="margin:0 0 8px;">California residents may request to know/access, delete, correct, and opt out of sale/sharing of personal information, and may request limitation of sensitive data use where applicable.</p>
    <ul style="margin:0;padding-left:20px;">
      <li>Privacy Request Portal: <a href="/privacy-request">/privacy-request</a></li>
      <li>Do Not Sell/Share: <a href="/do-not-sell">/do-not-sell</a></li>
      <li>Cookie Policy: <a href="/cookie-policy">/cookie-policy</a></li>
    </ul>
  </section>

  <section style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Risk Findings and Prioritized Fixes</h3>
    <ul style="margin:0;padding-left:20px;">${issueListMarkup(issues)}</ul>
  </section>

  <section style="background:#fff;border:1px solid #cfe0ff;border-radius:10px;padding:14px;margin:0 0 12px;">
    <h3 style="margin:0 0 8px;">Integration Preservation Analysis</h3>
    <p style="margin:0 0 8px;">This remediation package was generated in additive mode to reduce breakage risk for existing backend and API integrations.</p>
    <p style="margin:0 0 6px;"><strong>Detected client-side vendors</strong></p>
    <ul style="margin:0 0 8px;padding-left:20px;">${vendorMarkup(analysis.detected_vendors || [])}</ul>
    <p style="margin:0 0 6px;"><strong>Detected API endpoints</strong></p>
    <ul style="margin:0 0 8px;padding-left:20px;">${endpointMarkup(analysis.api_endpoints || [])}</ul>
    <p style="margin:0 0 6px;"><strong>Detected form targets</strong></p>
    <ul style="margin:0;padding-left:20px;">${formActionMarkup(analysis.form_actions || [])}</ul>
  </section>

  <p style="font-size:12px;color:#5a6778;margin:8px 0 0;">${escapeHtml(LEGAL_DISCLAIMER)}</p>
</section>`;
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
  const sectionMarkup = buildComplianceSection({
    website,
    issues: Array.isArray(issues) ? issues : [],
    analysis,
    generatedAt: new Date().toISOString()
  });

  return {
    remediatedHtml: injectComplianceSection(sourceHtml, sectionMarkup),
    analysis
  };
}

module.exports = {
  generatePaidRemediation
};
