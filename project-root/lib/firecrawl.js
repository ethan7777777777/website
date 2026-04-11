const FIRECRAWL_API_BASE = process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev";

function getFirecrawlKey() {
  return process.env.FIRECRAWL_API_KEY || "";
}

async function scrapeWebsite(url) {
  const apiKey = getFirecrawlKey();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }

  const response = await fetch(`${FIRECRAWL_API_BASE}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ["html", "markdown"]
    })
  });

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

module.exports = {
  scrapeWebsite
};
