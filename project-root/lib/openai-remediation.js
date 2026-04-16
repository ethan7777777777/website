function getModel() {
  return process.env.OPENAI_MODEL || "gpt-5.1-codex";
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function trimHtml(html) {
  const max = Number(process.env.REMEDIATION_HTML_CHAR_LIMIT || 30000);
  const value = String(html || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n<!-- truncated_for_model_input -->`;
}

function parseJsonFromText(text) {
  const value = String(text || "").trim();
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_err) {
    // Try fenced JSON fallback
  }

  const fenced = value.match(/```json\s*([\s\S]*?)```/i) || value.match(/```([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_err) {
      // continue
    }
  }

  // Last-resort extraction: first '{' to last '}' block.
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = value.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

function readResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (typeof payload.text === "string") return payload.text;

  const outputs = Array.isArray(payload.output) ? payload.output : [];
  const parts = [];
  for (const out of outputs) {
    const content = Array.isArray(out.content) ? out.content : [];
    for (const item of content) {
      if (item?.type === "output_text" && typeof item.text === "string") {
        parts.push(item.text);
      }
      if (item?.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function generateRemediationWithModel(input) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = getModel();
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_REMEDIATION_TIMEOUT_MS || 45000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      max_output_tokens: Number(process.env.OPENAI_REMEDIATION_MAX_OUTPUT_TOKENS || 2200),
      text: {
        format: {
          type: "json_schema",
          name: "remediation_result",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              approved: { type: "boolean" },
              summary: { type: "string" },
              breakage_risks: { type: "array", items: { type: "string" } },
              changes_applied: { type: "array", items: { type: "string" } },
              required_followups: { type: "array", items: { type: "string" } },
              remediated_html: { type: "string" }
            },
            required: [
              "approved",
              "summary",
              "breakage_risks",
              "changes_applied",
              "required_followups",
              "remediated_html"
            ]
          }
        }
      },
      input: [
        {
          role: "system",
          content:
            "You are a senior web remediation engineer. Preserve backend/API behavior and apply additive CCPA changes. Return strict JSON."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Context Policy JSON:\n${JSON.stringify(input.context)}`,
                `Lead Memory JSON:\n${JSON.stringify(input.memory)}`,
                `Website: ${input.website}`,
                `Detected issues JSON:\n${JSON.stringify(input.issues)}`,
                `Integration analysis JSON:\n${JSON.stringify(input.integration)}`,
                "Do not remove existing APIs/forms/scripts unless absolutely required for safety.",
                `Source HTML:\n${trimHtml(input.html)}`
              ].join("\n\n")
            }
          ]
        }
      ]
    })
  }).finally(() => clearTimeout(timer));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `OpenAI request failed (${response.status})`;
    throw new Error(message);
  }

  const rawText = readResponseText(payload);
  const parsed = parseJsonFromText(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned non-JSON output");
  }

  const remediatedHtml = String(parsed.remediated_html || "").trim();
  if (!remediatedHtml) {
    throw new Error("Model output missing remediated_html");
  }

  return {
    model,
    approved: Boolean(parsed.approved),
    summary: String(parsed.summary || ""),
    breakage_risks: Array.isArray(parsed.breakage_risks) ? parsed.breakage_risks.map(String) : [],
    changes_applied: Array.isArray(parsed.changes_applied) ? parsed.changes_applied.map(String) : [],
    required_followups: Array.isArray(parsed.required_followups) ? parsed.required_followups.map(String) : [],
    remediated_html: remediatedHtml,
    raw_json: parsed
  };
}

module.exports = {
  generateRemediationWithModel
};
