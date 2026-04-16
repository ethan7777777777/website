function getModel() {
  return process.env.OPENAI_MODEL || "gpt-5.1-codex";
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function trimHtml(html) {
  const max = Number(process.env.REMEDIATION_HTML_CHAR_LIMIT || 180000);
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
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content:
            "You are a senior web remediation engineer. Return strict JSON only. Preserve backend/API behavior and apply additive CCPA changes."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Context Policy JSON:\n${JSON.stringify(input.context)}`
            },
            {
              type: "input_text",
              text: `Lead Memory JSON:\n${JSON.stringify(input.memory)}`
            },
            {
              type: "input_text",
              text: `Website: ${input.website}`
            },
            {
              type: "input_text",
              text: `Detected issues JSON:\n${JSON.stringify(input.issues)}`
            },
            {
              type: "input_text",
              text: `Integration analysis JSON:\n${JSON.stringify(input.integration)}`
            },
            {
              type: "input_text",
              text:
                "Return JSON with keys: approved(boolean), summary(string), breakage_risks(string[]), changes_applied(string[]), required_followups(string[]), remediated_html(string)."
            },
            {
              type: "input_text",
              text: `Source HTML:\n${trimHtml(input.html)}`
            }
          ]
        }
      ]
    })
  });

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
