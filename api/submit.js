const { ensureSchema, getPool } = require("../lib/db");
const { runComplianceScanForLead } = require("../lib/compliance-pipeline");
const { createPaidPlanCheckoutSession } = require("../lib/stripe");
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
    const initialPaymentStatus = plan === PLAN_FIX_299 ? "pending" : "not_required";
    const insert = await pool.query(
      `INSERT INTO compliance_requests (business_name, email, locations, website, plan, report_token, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, plan, report_token, email, payment_status`,
      [normalized.business_name, normalized.email, normalized.locations, normalized.website, plan, reportToken, initialPaymentStatus]
    );

    const lead = insert.rows[0];
    const scan = await runComplianceScanForLead(lead.id, normalized.website);
    const reportPath = `/api/public-report?lead_id=${lead.id}&token=${lead.report_token}`;
    const downloadPath = `/api/download-remediated?lead_id=${lead.id}&token=${lead.report_token}`;

    let checkoutUrl = null;
    let paymentStatus = lead.plan === PLAN_FIX_299 ? "pending" : "not_required";
    let paymentMessage = null;
    if (lead.plan === PLAN_FIX_299) {
      try {
        const session = await createPaidPlanCheckoutSession({
          req,
          lead,
          reportPath,
          downloadPath
        });
        checkoutUrl = session.url || null;
        await pool.query(
          `UPDATE compliance_requests
           SET stripe_session_id = $2
           WHERE id = $1`,
          [lead.id, session.id]
        );
      } catch (stripeError) {
        paymentStatus = "checkout_unavailable";
        paymentMessage = stripeError.message || "Payment checkout is temporarily unavailable";
        await pool.query(
          `UPDATE compliance_requests
           SET payment_status = 'checkout_unavailable'
           WHERE id = $1`,
          [lead.id]
        );
      }
    }

    return res.status(200).json({
      message: "Lead captured successfully",
      id: lead.id,
      plan: lead.plan,
      payment_status: paymentStatus,
      payment_message: paymentMessage,
      scan,
      report_url: reportPath,
      checkout_url: checkoutUrl,
      download_url: null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
};
