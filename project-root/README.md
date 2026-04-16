# ComplianceCurrent

## Environment Variables

Set these in Vercel project settings:

- `DATABASE_URL` - Postgres connection string
- `AI_READ_API_KEY` - Bearer token used to read lead and scan APIs
- `FIRECRAWL_API_KEY` - Firecrawl API key for website scraping
- `FIRECRAWL_API_BASE` (optional) - defaults to `https://api.firecrawl.dev`
- `OPENAI_API_KEY` - OpenAI API key for model-based paid remediation
- `OPENAI_MODEL` - generation model id (example: `gpt-5.1-codex`)
- `OPENAI_REVIEW_MODEL` - review/JSON-validation model id (default: `gpt-5`)
- `REMEDIATION_HTML_CHAR_LIMIT` (optional) - cap for model input HTML length (default `180000`)

## API Endpoints

- `POST /api/submit`
  - Accepts form fields:
    - `clinic_name` (or `business_name`)
    - `work_email` (or `email`)
    - `number_of_locations` (or `locations`)
    - `website`
  - Saves lead and triggers Firecrawl-based CCPA scan

- `GET /api/leads?limit=50`
  - Requires `Authorization: Bearer <AI_READ_API_KEY>`
  - Returns leads plus latest scan status and risk score

- `GET /api/scan-result?lead_id=<id>`
  - Requires `Authorization: Bearer <AI_READ_API_KEY>`
  - Returns scan issues, risk score, and `remediated_html` with compliance additions

- `GET /api/public-report?lead_id=<id>&token=<report_token>`
  - Public report endpoint for customer delivery
  - Returns risk score, issues, and compliance findings
  - Includes `download_url` for paid (`fix_299`) plans

- `GET /api/download-remediated?lead_id=<id>&token=<report_token>`
  - Downloads generated remediated website HTML
  - Available only for paid (`fix_299`) scans after payment
  - If advanced paid remediation is not ready, endpoint auto-runs remediation and retries

- `POST /api/remediate?lead_id=<id>`
  - Requires `Authorization: Bearer <AI_READ_API_KEY>`
  - Force-runs paid remediation generation for a lead
  - Optional `force=false` to skip regeneration when already ready

## Paid Remediation Worker

- On Stripe `checkout.session.completed`, the webhook now triggers a paid remediation worker.
- Worker behavior:
  - re-analyzes the scraped site HTML
  - detects forms, API endpoints, and third-party integrations
  - loads persistent context policy from `config/remediation-context.json`
  - loads prior lead memory from `firecrawl_raw.remediation_memory`
  - uses `OPENAI_MODEL` for generation + review of paid remediations
  - falls back to deterministic additive remediation if model call fails or rejects output
  - generates additive compliance sections designed to avoid breaking backend/API flows
  - stores remediation analysis metadata in `firecrawl_raw.remediation_analysis`
  - stores remediation memory metadata in `firecrawl_raw.remediation_memory`
  - updates scan fields: `remediation_status`, `remediation_error`, and `remediated_at`

### Manual CLI

```bash
npm run remediate:lead -- <lead_id> [force=true|false]
```

## Legal Note

This scanner provides AI-generated compliance guidance and is not legal advice.
