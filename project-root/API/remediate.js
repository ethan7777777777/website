const { generatePaidRemediationForLead } = require("../lib/remediation-worker");

function isAuthorized(req) {
  const expected = process.env.AI_READ_API_KEY;
  if (!expected) {
    return false;
  }
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${expected}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const leadId = Number(req.body?.lead_id || req.query?.lead_id || 0);
  const force = String(req.body?.force ?? req.query?.force ?? "true") !== "false";

  if (!Number.isInteger(leadId) || leadId < 1) {
    return res.status(400).json({ error: "lead_id is required" });
  }

  try {
    const result = await generatePaidRemediationForLead(leadId, { force });
    return res.status(200).json({
      ok: true,
      lead_id: leadId,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate paid remediation",
      details: error.message
    });
  }
};
