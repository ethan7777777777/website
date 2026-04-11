const FIRECRAWL_API_BASE = process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev";

function getFirecrawlKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    const candidate = String(url || "").trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

async function mapWebsite(url) {
  const apiKey = getFirecrawlKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      search: "privacy policy do not sell cookie legal notice terms contact request california consumer privacy",
      limit: 50
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return [];
  }

  const links = payload.links || payload.data?.links || [];
  return Array.isArray(links) ? links : [];
}

function rankCandidateUrls(urls) {
  const scored = urls.map((u) => {
    const lower = String(u).toLowerCase();
    let score = 0;
    if (lower.includes("privacy")) score += 8;
    if (lower.includes("do-not-sell") || lower.includes("do_not_sell") || lower.includes("do not sell")) score += 8;
    if (lower.includes("ccpa")) score += 7;
    if (lower.includes("california")) score += 5;
    if (lower.includes("cookie")) score += 5;
    if (lower.includes("legal")) score += 4;
    if (lower.includes("notice")) score += 4;
    if (lower.includes("contact")) score += 3;
    if (lower.includes("request")) score += 3;
    if (lower.includes("policy")) score += 2;
    return { u, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .map((x) => x.u);
}

async function submitExtractJob(urls) {
  const apiKey = getFirecrawlKey();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      urls,
      prompt:
        "Extract CCPA-relevant compliance evidence from each page. Capture privacy policy text, consumer rights, do-not-sell/share controls, notice-at-collection, cookie/tracking disclosures, and request channels.",
      schema: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pageUrl: { type: "string" },
                hasPrivacyPolicy: { type: "boolean" },
                hasConsumerRightsDisclosure: { type: "boolean" },
                hasDoNotSellOrShare: { type: "boolean" },
                hasNoticeAtCollection: { type: "boolean" },
                hasCookieDisclosure: { type: "boolean" },
                requestChannels: {
                  type: "array",
                  items: { type: "string" }
                },
                evidenceText: { type: "string" }
              },
              required: ["pageUrl", "evidenceText"]
            }
          }
        },
        required: ["findings"]
      },
      showSources: true,
      ignoreInvalidURLs: true,
      scrapeOptions: {
        formats: ["rawHtml", "html", "markdown", "links"],
        onlyMainContent: false,
        waitFor: 2500,
        timeout: 45000,
        blockAds: false,
        removeBase64Images: true
      }
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Firecrawl extract submit failed (${response.status})`);
  }

  const id = payload.id || payload.data?.id;
  if (!id) {
    throw new Error("Firecrawl extract did not return a job id");
  }

  return { id, submitPayload: payload };
}

async function getExtractJobStatus(id) {
  const apiKey = getFirecrawlKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/extract/${id}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Firecrawl extract status failed (${response.status})`);
  }

  return payload;
}

async function runExtract(urls) {
  const { id, submitPayload } = await submitExtractJob(urls);
  const startedAt = Date.now();
  const timeoutMs = 90_000;
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await getExtractJobStatus(id);
    const status = String(latest.status || "").toLowerCase();

    if (status === "completed") {
      return { id, submitPayload, resultPayload: latest };
    }
    if (status === "failed" || status === "cancelled") {
      throw new Error(latest.error || latest.message || `Firecrawl extract job ${status}`);
    }

    await sleep(1500);
  }

  throw new Error("Firecrawl extract timed out before completion");
}

function collectSourcePages(resultPayload) {
  const data = resultPayload.data || {};
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const pages = [];

  for (const source of sources) {
    const pageUrl = source.url || source.sourceURL || source.sourceUrl || "";
    const html = source.rawHtml || source.html || "";
    const markdown = source.markdown || "";
    if (!pageUrl && !html && !markdown) continue;
    pages.push({
      url: pageUrl,
      html,
      markdown,
      metadata: source.metadata || {}
    });
  }

  return pages;
}

function collectExtractedFindings(resultPayload) {
  const data = resultPayload.data || {};
  const directFindings = Array.isArray(data.findings) ? data.findings : [];

  if (directFindings.length > 0) {
    return directFindings;
  }

  // Some responses return the extraction payload nested under `data.data`.
  const nestedFindings = Array.isArray(data.data?.findings) ? data.data.findings : [];
  return nestedFindings;
}

function findingsToText(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return "";
  return findings
    .map((f) => {
      const channels = Array.isArray(f.requestChannels) ? f.requestChannels.join(", ") : "";
      return [
        `pageUrl: ${f.pageUrl || ""}`,
        `hasPrivacyPolicy: ${String(!!f.hasPrivacyPolicy)}`,
        `hasConsumerRightsDisclosure: ${String(!!f.hasConsumerRightsDisclosure)}`,
        `hasDoNotSellOrShare: ${String(!!f.hasDoNotSellOrShare)}`,
        `hasNoticeAtCollection: ${String(!!f.hasNoticeAtCollection)}`,
        `hasCookieDisclosure: ${String(!!f.hasCookieDisclosure)}`,
        `requestChannels: ${channels}`,
        `evidenceText: ${f.evidenceText || ""}`
      ].join("\n");
    })
    .join("\n\n");
}

async function scrapeWebsiteBundle(url) {
  const mapped = await mapWebsite(url);
  const ranked = rankCandidateUrls(mapped).filter((u) => u && u !== url).slice(0, 10);
  const urls = uniqueUrls([url, ...ranked]);

  const { id, submitPayload, resultPayload } = await runExtract(urls);
  const pages = collectSourcePages(resultPayload);
  const extractedFindings = collectExtractedFindings(resultPayload);

  const combinedHtml = pages.map((p) => p.html).filter(Boolean).join("\n\n");
  const combinedMarkdown = [
    ...pages.map((p) => p.markdown).filter(Boolean),
    findingsToText(extractedFindings)
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    html: combinedHtml,
    markdown: combinedMarkdown,
    metadata: {
      extract_job_id: id
    },
    pages_scanned: pages.length
      ? pages.map((p) => ({ url: p.url, kind: "extract-source" }))
      : urls.map((u) => ({ url: u, kind: "extract-target" })),
    raw: {
      mode: "extract",
      submit: submitPayload,
      result: resultPayload,
      mapped_links: mapped,
      targeted_urls: urls,
      extracted_findings: extractedFindings
    }
  };
}

module.exports = {
  scrapeWebsiteBundle
};
