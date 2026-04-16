const fs = require("fs");
const path = require("path");

const CONTEXT_PATH = path.join(process.cwd(), "config", "remediation-context.json");

function defaultContext() {
  return {
    version: "default",
    goal: "Generate safe additive CCPA remediation.",
    hard_constraints: [
      "Preserve existing backend/API behavior.",
      "Prefer additive changes."
    ],
    ccpa_requirements: [],
    review_rubric: {
      approve_only_if: [],
      reject_if: []
    },
    output_schema: {}
  };
}

function loadRemediationContext() {
  try {
    const raw = fs.readFileSync(CONTEXT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return defaultContext();
  } catch (_error) {
    return defaultContext();
  }
}

module.exports = {
  loadRemediationContext
};
