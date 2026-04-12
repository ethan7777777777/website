let stripeClient;

function getStripeClient() {
  if (stripeClient) return stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  const Stripe = require("stripe");
  stripeClient = new Stripe(secretKey, { apiVersion: "2025-03-31.basil" });
  return stripeClient;
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  if (!host) {
    throw new Error("Unable to infer base URL. Set APP_BASE_URL env var.");
  }
  return `${proto}://${host}`;
}

function getSuccessUrl(req) {
  const configured = process.env.STRIPE_SUCCESS_URL || "";
  if (configured) return configured;
  return `${getBaseUrl(req)}/?checkout=success`;
}

function getCancelUrl(req) {
  const configured = process.env.STRIPE_CANCEL_URL || "";
  if (configured) return configured;
  return `${getBaseUrl(req)}/?checkout=cancelled`;
}

function getStripePrices() {
  const setupPriceId = process.env.STRIPE_PRICE_SETUP_ID || "";
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY_ID || "";
  if (!setupPriceId || !monthlyPriceId) {
    throw new Error("STRIPE_PRICE_SETUP_ID and STRIPE_PRICE_MONTHLY_ID are required");
  }
  return { setupPriceId, monthlyPriceId };
}

function appendQueryParams(url, params) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    u.searchParams.set(key, String(value));
  }
  return u.toString();
}

async function createPaidPlanCheckoutSession({ req, lead, reportPath, downloadPath }) {
  const stripe = getStripeClient();
  const { setupPriceId, monthlyPriceId } = getStripePrices();
  const delayDays = Number(process.env.STRIPE_SUBSCRIPTION_DELAY_DAYS || 30);
  const trialPeriodDays = Number.isInteger(delayDays) && delayDays > 0 ? delayDays : 30;

  const successUrl = appendQueryParams(getSuccessUrl(req), {
    lead_id: lead.id,
    token: lead.report_token
  });
  const cancelUrl = appendQueryParams(getCancelUrl(req), {
    lead_id: lead.id
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      { price: setupPriceId, quantity: 1 },
      { price: monthlyPriceId, quantity: 1 }
    ],
    subscription_data: {
      trial_period_days: trialPeriodDays
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: lead.email,
    metadata: {
      lead_id: String(lead.id),
      report_path: reportPath,
      download_path: downloadPath
    }
  });

  return session;
}

module.exports = {
  getStripeClient,
  createPaidPlanCheckoutSession
};
