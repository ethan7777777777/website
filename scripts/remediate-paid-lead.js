#!/usr/bin/env node

const { generatePaidRemediationForLead } = require("../lib/remediation-worker");

async function main() {
  const leadId = Number(process.argv[2] || 0);
  const force = String(process.argv[3] || "true") !== "false";

  if (!Number.isInteger(leadId) || leadId < 1) {
    console.error("Usage: node scripts/remediate-paid-lead.js <lead_id> [force=true|false]");
    process.exit(1);
  }

  try {
    const result = await generatePaidRemediationForLead(leadId, { force });
    console.log(JSON.stringify({ ok: true, lead_id: leadId, ...result }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, lead_id: leadId, error: error.message }, null, 2));
    process.exit(1);
  }
}

main();
