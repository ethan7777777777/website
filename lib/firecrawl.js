const FIRECRAWL_API_BASE = process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev";

function getFirecrawlKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

async function scrapeWebsite(url) {
  const apiKey = getFirecrawlKey();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ["html", "markdown"]
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Firecrawl error (${response.status})`);
  }

  const data = payload.data || payload;
  return {
    html: data.html || "",
    markdown: data.markdown || "",
    metadata: data.metadata || {},
    raw: payload
  };
}

async function mapWebsite(url) {
  const apiKey = getFirecrawlKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      search: "privacy policy do not sell cookie contact request",
      limit: 25
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
    if (lower.includes("privacy")) score += 6;
    if (lower.includes("do-not-sell") || lower.includes("do_not_sell") || lower.includes("do not sell")) score += 6;
    if (lower.includes("cookie")) score += 4;
    if (lower.includes("contact")) score += 3;
    if (lower.includes("request")) score += 3;
    if (lower.includes("policy")) score += 2;
    return { u, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .map((x) => x.u);
}

async function scrapeWebsiteBundle(url) {
  const primary = await scrapeWebsite(url);
  const mapped = await mapWebsite(url);
  const ranked = rankCandidateUrls(mapped).filter((u) => u && u !== url).slice(0, 4);

  const extraPages = [];
  for (const candidate of ranked) {
    try {
      const page = await scrapeWebsite(candidate);
      extraPages.push({
        url: candidate,
        html: page.html || "",
        markdown: page.markdown || "",
        metadata: page.metadata || {},
        raw: page.raw || {}
      });
    } catch (_e) {
      // Skip page-level failures; keep best-effort crawl.
    }
  }

  const combinedHtml = [primary.html, ...extraPages.map((p) => p.html)].join("\n\n");
  const combinedMarkdown = [primary.markdown, ...extraPages.map((p) => p.markdown)].join("\n\n");

  return {
    html: combinedHtml,
    markdown: combinedMarkdown,
    metadata: primary.metadata || {},
    pages_scanned: [
      { url, kind: "primary" },
      ...extraPages.map((p) => ({ url: p.url, kind: "mapped" }))
    ],
    raw: {
      primary: primary.raw,
      mapped_links: mapped,
      extra_pages: extraPages.map((p) => ({ url: p.url, metadata: p.metadata, raw: p.raw }))
    }
  };
}

module.exports = {
  scrapeWebsite,
  scrapeWebsiteBundle
};
