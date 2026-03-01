# GEMI Intelligence

Type any Greek company name and get a due diligence report in about 60 seconds.

## What It Includes

- Playwright GEMI scraper (React/MUI SPA aware, accordion expansion included)
- Server pipeline with live stage events over SSE
- Risk scoring + AI narrative synthesis (OpenAI optional with deterministic fallback)
- Supabase-backed caching with in-memory fallback
- Premium dark UI flow: landing -> loading -> report -> share
- PDF export endpoint

## Stack

- Next.js 16 App Router + TypeScript
- Playwright
- OpenAI SDK
- Supabase JS client
- Framer Motion + Lucide icons

## Quick Start

1. Install dependencies:

```bash
pnpm install
pnpm exec playwright install chromium
```

2. Configure environment:

```bash
cp .env.example .env.local
```

Supabase server writes require one backend key:
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY` (legacy)
- Never expose server keys with `NEXT_PUBLIC_`

3. (Optional but recommended) Apply SQL schema in Supabase SQL editor:

- [supabase/schema.sql](/Users/dimitristheodoropoulos/Dev/hackathon/supabase/schema.sql)

4. Run dev server:

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Troubleshooting

If PDF export fails with `Executable doesn't exist at ... chrome-headless-shell`, install browsers:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 pnpm exec playwright install chromium
```

For hosted deployments, ensure the same `PLAYWRIGHT_BROWSERS_PATH=0` env var is present at runtime.

## API Routes

- `POST /api/search` -> starts pipeline, returns `search_id`
- `GET /api/search/:id/stream` -> SSE stage updates
- `GET /api/report/:id` -> report JSON
- `GET /api/report/share/:token` -> report JSON by share token
- `POST /api/report/:id/pdf` -> generated PDF

## Notes

- If live GEMI scraping fails (network/selector drift), the pipeline returns a transparent demo fallback dataset so the full UX still runs.
- Add `GEMINI_API_KEY` (recommended for free tier) or `OPENAI_API_KEY` for AI synthesis; otherwise the app uses deterministic legal-risk heuristics.
- Add `SERPAPI_KEY` for live news enrichment.
