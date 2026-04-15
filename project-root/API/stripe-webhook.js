const { ensureSchema, getPool } = require("../lib/db");
const { getStripeClient } = require("../lib/stripe");
const { generatePaidRemediationForLead } = require("../lib/remediation-worker");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: "Missing Stripe webhook signature or secret" });
  }

  try {
    const rawBody = await readRawBody(req);
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    await ensureSchema();
    const pool = getPool();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const leadId = Number(session.metadata?.lead_id || 0);
      if (Number.isInteger(leadId) && leadId > 0) {
        await pool.query(
          `UPDATE compliance_requests
           SET payment_status = 'paid',
               stripe_session_id = $2,
               stripe_customer_id = COALESCE($3, stripe_customer_id),
               stripe_subscription_id = COALESCE($4, stripe_subscription_id)
           WHERE id = $1`,
          [
            leadId,
            session.id,
            session.customer ? String(session.customer) : null,
            session.subscription ? String(session.subscription) : null
          ]
        );

        try {
          await generatePaidRemediationForLead(leadId, { force: true });
        } catch (_remediationError) {
          // Keep webhook success semantics; remediation can be retried on download.
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const leadId = Number(session.metadata?.lead_id || 0);
      if (Number.isInteger(leadId) && leadId > 0) {
        await pool.query(
          `UPDATE compliance_requests
           SET payment_status = 'expired',
               stripe_session_id = $2
           WHERE id = $1 AND payment_status = 'pending'`,
          [leadId, session.id]
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(400).json({
      error: "Webhook verification failed",
      details: error.message
    });
  }
};
