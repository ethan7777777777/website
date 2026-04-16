function getGenerationModel() {
  return process.env.OPENAI_MODEL || "gpt-5.1-codex";
}

function getReviewModel() {
  return process.env.OPENAI_REVIEW_MODEL || "gpt-5";
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function trimHtml(html) {
  const max = Number(process.env.REMEDIATION_HTML_CHAR_LIMIT || 12000);
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
    // continue
  }

  const fenced = value.match(/```json\s*([\s\S]*?)```/i) || value.match(/```([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_err) {
      // continue
    }
  }

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

function readResponseJson(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.output_parsed && typeof payload.output_parsed === "object") {
    return payload.output_parsed;
  }

  const outputs = Array.isArray(payload.output) ? payload.output : [];
  for (const out of outputs) {
    const content = Array.isArray(out.content) ? out.content : [];
    for (const item of content) {
      if (item?.type === "output_json" && item.json && typeof item.json === "object") {
        return item.json;
      }
      if (item?.parsed && typeof item.parsed === "object") {
        return item.parsed;
      }
      if (typeof item?.text === "string") {
        const parsedText = parseJsonFromText(item.text);
        if (parsedText && typeof parsedText === "object") {
          return parsedText;
        }
      }
    }
  }

  return null;
}

function extractHtmlFromText(text) {
  const value = String(text || "").trim();
  if (!value) return "";

  const fencedHtml = value.match(/```html\s*([\s\S]*?)```/i);
  if (fencedHtml?.[1]) return fencedHtml[1].trim();

  const start = value.toLowerCase().indexOf("<html");
  const end = value.toLowerCase().lastIndexOf("</html>");
  if (start >= 0 && end > start) {
    return value.slice(start, end + 7).trim();
  }

  return value;
}

async function callResponsesApi({ apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    signal: controller.signal,
    body: JSON.stringify(body)
  }).finally(() => clearTimeout(timer));

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `OpenAI request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

async function generateCandidateHtml(input, apiKey) {
  const model = getGenerationModel();
  const timeoutMs = Number(process.env.OPENAI_REMEDIATION_TIMEOUT_MS || 45000);

  const payload = await callResponsesApi({
    apiKey,
    timeoutMs,
    body: {
      model,
      max_output_tokens: Number(process.env.OPENAI_REMEDIATION_MAX_OUTPUT_TOKENS || 2200),
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "remediation_generation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              remediated_html: { type: "string" },
              summary: { type: "string" }
            },
            required: ["remediated_html", "summary"]
          }
        }
      },
      input: [
        {
          role: "system",
          content:
            "You are a senior web remediation engineer. Preserve backend/API behavior and apply additive CCPA controls. Return JSON where remediated_html is only additive module markup (style + compliance section), not a full page."
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
                "Hard rule: keep existing scripts/forms/endpoints and avoid destructive rewrites.",
                "Return only additive compliance module markup for remediated_html (e.g. <style id=\"compliancecurrent-theme\">...</style><section id=\"compliancecurrent-remediation-pack\">...</section>).",
                `Source HTML:\n${trimHtml(input.html)}`
              ].join("\n\n")
            }
          ]
        }
      ]
    }
  });

  const generatedJson = readResponseJson(payload);
  const text = readResponseText(payload);
  const candidateHtml = generatedJson?.remediated_html
    ? String(generatedJson.remediated_html).trim()
    : extractHtmlFromText(text);
  if (!candidateHtml) {
    throw new Error("Generation model returned empty HTML output");
  }

  return {
    model,
    candidate_html: candidateHtml
  };
}

async function reviewCandidateHtml(input, apiKey, candidate) {
  const reviewModel = getReviewModel();
  const timeoutMs = Number(process.env.OPENAI_REVIEW_TIMEOUT_MS || 25000);

  const payload = await callResponsesApi({
    apiKey,
    timeoutMs,
    body: {
      model: reviewModel,
      max_output_tokens: Number(process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS || 1200),
      text: {
        format: {
          type: "json_schema",
          name: "remediation_review",
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
            "You are a strict reviewer. Approve only if backend/API compatibility is preserved and CCPA controls are present. remediated_html should be additive module markup only. Return JSON only."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Context Policy JSON:\n${JSON.stringify(input.context)}`,
                `Integration analysis JSON:\n${JSON.stringify(input.integration)}`,
                `Candidate remediated HTML:\n${trimHtml(candidate.candidate_html)}`,
                "If safe and compliant, set approved=true and return remediated_html."
              ].join("\n\n")
            }
          ]
        }
      ]
    }
  });

  const rawText = readResponseText(payload);
  const parsed = readResponseJson(payload) || parseJsonFromText(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Review model returned non-JSON output");
  }

  return {
    review_model: reviewModel,
    approved: Boolean(parsed.approved),
    summary: String(parsed.summary || ""),
    breakage_risks: Array.isArray(parsed.breakage_risks) ? parsed.breakage_risks.map(String) : [],
    changes_applied: Array.isArray(parsed.changes_applied) ? parsed.changes_applied.map(String) : [],
    required_followups: Array.isArray(parsed.required_followups) ? parsed.required_followups.map(String) : [],
    remediated_html: String(parsed.remediated_html || "").trim(),
    raw_json: parsed
  };
}

async function generateRemediationWithModel(input) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const generated = await generateCandidateHtml(input, apiKey);
  const reviewed = await reviewCandidateHtml(input, apiKey, generated);

  if (!reviewed.remediated_html) {
    throw new Error("Review output missing remediated_html");
  }

  return {
    model: generated.model,
    review_model: reviewed.review_model,
    approved: reviewed.approved,
    summary: reviewed.summary,
    breakage_risks: reviewed.breakage_risks,
    changes_applied: reviewed.changes_applied,
    required_followups: reviewed.required_followups,
    remediated_html: reviewed.remediated_html,
    raw_json: {
      generation_model: generated.model,
      review_model: reviewed.review_model,
      review: reviewed.raw_json
    }
  };
}

module.exports = {
  generateRemediationWithModel
};
