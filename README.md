# ComplianceCurrent

## Environment Variables

Set these in Vercel project settings:

- `DATABASE_URL` - Postgres connection string
- `AI_READ_API_KEY` - Bearer token used to read lead and scan APIs
- `FIRECRAWL_API_KEY` - Firecrawl API key for website scraping
- `FIRECRAWL_API_BASE` (optional) - defaults to `https://api.firecrawl.dev`

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

## Legal Note

This scanner provides AI-generated compliance guidance and is not legal advice.
