const FIRECRAWL_API_BASE = process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev";

function getFirecrawlKey() {
  return (
    process.env.FIRECRAWL_API_KEY ||
    process.env.FIRECRAWL_KEY ||
    process.env.FIRECRAWL_TOKEN ||
    ""
  );
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

function toAbsoluteUrl(baseUrl, pathOrUrl) {
  try {
    return new URL(pathOrUrl, baseUrl).toString();
  } catch (_e) {
    return "";
  }
}

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
    markdown: html || "",
    metadata: {
      status: response.status,
      contentType: response.headers.get("content-type") || ""
    }
  };
}

async function directWebsiteFallback(url) {
  const targets = uniqueUrls([
    url,
    toAbsoluteUrl(url, "/privacy-policy"),
    toAbsoluteUrl(url, "/privacy"),
    toAbsoluteUrl(url, "/do-not-sell"),
    toAbsoluteUrl(url, "/privacy-request"),
    toAbsoluteUrl(url, "/contact")
  ]).slice(0, 6);

  const pages = [];
  for (const target of targets) {
    try {
      const page = await fetchPageDirect(target);
      pages.push(page);
    } catch (_e) {
      // best effort fallback
    }
  }

  const combinedHtml = pages.map((p) => p.html).filter(Boolean).join("\n\n");
  const combinedMarkdown = pages.map((p) => p.markdown).filter(Boolean).join("\n\n");
  if (!combinedHtml && !combinedMarkdown) {
    throw new Error("Unable to fetch target website content directly");
  }

  return {
    html: combinedHtml,
    markdown: combinedMarkdown,
    metadata: { fallback: "direct_fetch" },
    pages_scanned: pages.map((p) => ({ url: p.url, kind: "direct-fallback" })),
    raw: {
      mode: "direct_fallback",
      targeted_urls: targets,
      pages: pages.map((p) => ({ url: p.url, metadata: p.metadata }))
    }
  };
}

async function mapWebsite(url) {
  const apiKey = getFirecrawlKey();
  if (!apiKey) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      search: "privacy policy do not sell cookie legal notice terms contact request california consumer privacy",
      limit: 30
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return [];
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

async function submitExtractJob(urls, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

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
        waitFor: 1800,
        timeout: 30000,
        blockAds: false,
        removeBase64Images: true
      }
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const message = payload.error || payload.message || `Firecrawl extract submit failed (${status})`;
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  const id = payload.id || payload.data?.id;
  if (!id) throw new Error("Firecrawl extract did not return a job id");
  return { id, submitPayload: payload };
}

async function getExtractJobStatus(id, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/extract/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const message = payload.error || payload.message || `Firecrawl extract status failed (${status})`;
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  return payload;
}

async function runExtract(urls, apiKey) {
  const { id, submitPayload } = await submitExtractJob(urls, apiKey);
  const startedAt = Date.now();
  const timeoutMs = 35_000;
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await getExtractJobStatus(id, apiKey);
    const status = String(latest.status || "").toLowerCase();
    if (status === "completed") return { id, submitPayload, resultPayload: latest };
    if (status === "failed" || status === "cancelled") {
      throw new Error(latest.error || latest.message || `Firecrawl extract job ${status}`);
    }
    await sleep(1200);
  }

  throw new Error("Firecrawl extract timed out before completion");
}

function collectSourcePages(resultPayload) {
  const data = resultPayload.data || {};
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const results = Array.isArray(data.results) ? data.results : [];
  const extractedPages = Array.isArray(data.pages) ? data.pages : [];
  const pages = [];

  const allCandidates = [...sources, ...results, ...extractedPages];
  for (const source of allCandidates) {
    const pageUrl = source.url || source.sourceURL || source.sourceUrl || source.pageUrl || "";
    const html = source.rawHtml || source.html || source.content || "";
    const markdown = source.markdown || source.text || "";
    if (!pageUrl && !html && !markdown) continue;
    pages.push({ url: pageUrl, html, markdown, metadata: source.metadata || source.meta || {} });
  }

  return pages;
}

function collectExtractedFindings(resultPayload) {
  const data = resultPayload.data || {};
  const candidates = [
    data.findings,
    data.data?.findings,
    data.output?.findings,
    data.extracted?.findings,
    data.result?.findings
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }
  return [];
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

async function scrapeSingle(url, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ["rawHtml", "html", "markdown", "links"],
      onlyMainContent: false,
      waitFor: 1600,
      timeout: 25000
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || payload.message || `Firecrawl scrape failed (${response.status})`;
    throw new Error(message);
  }
  const data = payload.data || payload;
  return {
    url,
    html: data.rawHtml || data.html || "",
    markdown: data.markdown || "",
    metadata: data.metadata || {},
    raw: payload
  };
}

async function scrapeFallback(urls, apiKey) {
  const pages = [];
  const targets = urls.slice(0, 5);
  for (const target of targets) {
    try {
      const page = await scrapeSingle(target, apiKey);
      pages.push(page);
    } catch (_e) {
      // best-effort fallback
    }
  }
  return pages;
}

async function scrapeWebsiteBundle(url) {
  const apiKey = getFirecrawlKey();
  if (!apiKey) {
    return directWebsiteFallback(url);
  }

  const mapped = await mapWebsite(url);
  const ranked = rankCandidateUrls(mapped).filter((u) => u && u !== url).slice(0, 8);
  const urls = uniqueUrls([url, ...ranked]);

  try {
    const { id, submitPayload, resultPayload } = await runExtract(urls, apiKey);
    const pages = collectSourcePages(resultPayload);
    const extractedFindings = collectExtractedFindings(resultPayload);
    const combinedHtml = pages.map((p) => p.html).filter(Boolean).join("\n\n");
    const combinedMarkdown = [...pages.map((p) => p.markdown).filter(Boolean), findingsToText(extractedFindings)]
      .filter(Boolean)
      .join("\n\n");

    if (!combinedHtml && !combinedMarkdown) {
      throw new Error("Extract returned no usable page content");
    }

    return {
      html: combinedHtml,
      markdown: combinedMarkdown,
      metadata: { extract_job_id: id },
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
  } catch (extractError) {
    const pages = await scrapeFallback(urls, apiKey);
    const combinedHtml = pages.map((p) => p.html).filter(Boolean).join("\n\n");
    const combinedMarkdown = pages.map((p) => p.markdown).filter(Boolean).join("\n\n");

    if (!combinedHtml && !combinedMarkdown) {
      return directWebsiteFallback(url);
    }

    return {
      html: combinedHtml,
      markdown: combinedMarkdown,
      metadata: { fallback: "scrape_after_extract_failure" },
      pages_scanned: pages.map((p) => ({ url: p.url, kind: "scrape-fallback" })),
      raw: {
        mode: "scrape_fallback",
        extract_error: extractError.message,
        mapped_links: mapped,
        targeted_urls: urls,
        pages: pages.map((p) => ({ url: p.url, metadata: p.metadata, raw: p.raw }))
      }
    };
  }
}

module.exports = {
  scrapeWebsiteBundle
};
