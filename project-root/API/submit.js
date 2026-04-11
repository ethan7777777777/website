const { ensureSchema, getPool } = require("../lib/db");
const { runComplianceScanForLead } = require("../lib/compliance-pipeline");
const crypto = require("crypto");

const PLAN_FREE_AUDIT = "free_audit";
const PLAN_FIX_299 = "fix_299";

function normalizePlan(rawPlan) {
  const value = String(rawPlan || "")
    .trim()
    .toLowerCase();
  if (value === PLAN_FIX_299) {
    return PLAN_FIX_299;
  }
  return PLAN_FREE_AUDIT;
}

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);
    const business_name = body.business_name || body.clinic_name;
    const email = body.email || body.work_email;
    const locations = body.locations || body.number_of_locations;
    const plan = normalizePlan(body.plan);
    const { website } = body;

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
    const pool = getPool();
    const reportToken = crypto.randomBytes(24).toString("hex");
    const insert = await pool.query(
      `INSERT INTO compliance_requests (business_name, email, locations, website, plan, report_token)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, plan, report_token`,
      [normalized.business_name, normalized.email, normalized.locations, normalized.website, plan, reportToken]
    );

    const scan = await runComplianceScanForLead(insert.rows[0].id, normalized.website);
    const reportPath = `/api/public-report?lead_id=${insert.rows[0].id}&token=${insert.rows[0].report_token}`;
    const downloadPath = `/api/download-remediated?lead_id=${insert.rows[0].id}&token=${insert.rows[0].report_token}`;

    return res.status(200).json({
      message: "Lead captured successfully",
      id: insert.rows[0].id,
      plan: insert.rows[0].plan,
      scan,
      report_url: reportPath,
      download_url: insert.rows[0].plan === PLAN_FIX_299 ? downloadPath : null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
