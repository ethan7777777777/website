const { ensureSchema, pool } = require("../lib/db");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }

    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      const contentType = req.headers["content-type"] || "";
      try {
        if (contentType.includes("application/json")) {
          resolve(JSON.parse(raw));
          return;
        }
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(raw);
          resolve(Object.fromEntries(params.entries()));
          return;
        }
        resolve({});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

async function queueFutureScan(website) {
  // Future step:
  // 1) fetch(website)
  // 2) parse HTML
  // 3) detect CCPA compliance signals
  return { queued: false, website };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);
    const { business_name, email, locations, website } = body;

    if (!business_name || !email || !locations || !website) {
      return res.status(400).json({
        error: "Missing required fields: business_name, email, locations, website"
      });
    }

    const normalized = {
      business_name: String(business_name).trim(),
      email: String(email).trim().toLowerCase(),
      locations: Number(locations),
      website: String(website).trim()
    };

    if (!Number.isInteger(normalized.locations) || normalized.locations < 1) {
      return res.status(400).json({ error: "locations must be a positive integer" });
    }

    try {
      new URL(normalized.website);
    } catch (_error) {
      return res.status(400).json({ error: "website must be a valid URL" });
    }

    await ensureSchema();
    const insert = await pool.query(
      `INSERT INTO compliance_requests (business_name, email, locations, website)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [normalized.business_name, normalized.email, normalized.locations, normalized.website]
    );

    await queueFutureScan(normalized.website);

    return res.status(200).json({
      message: "Lead captured successfully",
      id: insert.rows[0].id
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
