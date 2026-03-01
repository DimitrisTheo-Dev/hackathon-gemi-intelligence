# GEMI Intelligence

<img width="1510" height="749" alt="Gemi-Intelligence" src="https://github.com/user-attachments/assets/3ceed720-1771-4d60-acc9-ab7a1b5defee" />

**Loom Demo:** https://www.loom.com/share/3d2de5b9e45945e5ab6ed625fa0bd368

Built during **Hustle Hours Hackathon (February 28 - March 1, 2026)** in approximately **6 hours**.

Type any Greek company name and get a due diligence report in about 60 seconds.

## Problem It Solves

Due diligence for private deals is slow and expensive:

- Corporate registry checks are manual and fragmented
- Legal and finance teams spend days collecting and structuring evidence
- Early-stage investment decisions are delayed by data-gathering overhead

## Product

GEMI Intelligence turns one company query into a structured due diligence output:

- Live GEMI registry extraction
- Evidence-backed risk scoring
- AI advisor memo for investment committee context
- Compare mode between two companies
- Shareable report links
- PDF export for report, memo, and comparison

## Core User Flow

1. User submits company name, GEMI number, or VAT.
2. API launches an async pipeline (`/api/search`) and returns `search_id`.
3. Frontend shows real-time stage updates over SSE (`/api/search/:id/stream`).
4. Pipeline extracts registry data, enriches filings/news/PDF signals, then synthesizes a report.
5. User reviews report, simulates issue resolution impact, generates advisor memo, compares companies, and exports.

## Technical Workarounds & Decisions

### 1) Ambiguous company names

- We added GEMI candidate ranking and selection before running full pipeline.
- This avoids wrong-entity reports when names are similar.

### 2) Registry not found behavior

- If GEMI returns no matching company, pipeline now fails with a clear message:
  - "Company not found in GEMI registry. Please try a different company name, GEMI number, or VAT."
- No report is generated for this case; user is prompted to reprompt.

### 3) External dependency instability

- For transient upstream failures after lookup (timeouts/API instability), pipeline can still produce a deterministic fallback report marked as `demo-fallback`.
- This keeps the product demoable while making provenance explicit in the report.

### 4) Caching strategy for speed

- Report cache by GEMI number (local memory + Supabase) for instant cache hits on repeated companies.
- Advisor memo cache (fingerprinted by report + scenario) with TTL in `advisor_cache`.
- Compare mode reuses stored reports, so it benefits from the same cache path.

### 5) Long-running UX reliability

- Pipeline progress uses Server-Sent Events instead of blind polling.
- UI now handles temporary SSE disconnects by allowing reconnect behavior instead of forcing manual refresh.

### 6) Playwright PDF runtime issues

- Browser binaries are pinned to project-local path using `PLAYWRIGHT_BROWSERS_PATH=0`.
- Scripts include automatic browser install in `postinstall`.
- PDF endpoints return clear 503 JSON errors when Chromium is missing, instead of opaque crashes.

## Stack

- Next.js 16 App Router + TypeScript
- Playwright
- OpenAI SDK (optional) + Gemini support (optional)
- Supabase JS client
- Framer Motion + Lucide icons

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

3. (Optional but recommended) Apply SQL schema in Supabase SQL editor:

- [supabase/schema.sql](supabase/schema.sql)

4. Run dev server:

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Environment Notes

- Supabase server writes require one backend key:
  - `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY` (legacy)
  - Never expose server keys with `NEXT_PUBLIC_`
- Add `GEMINI_API_KEY` (recommended for free tier) or `OPENAI_API_KEY` for AI synthesis.
- Add `SERPAPI_KEY` for live news enrichment.

## Troubleshooting

If PDF export fails with `Executable doesn't exist at ... chrome-headless-shell`:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 pnpm exec playwright install chromium
```

If your deployment environment ignores lifecycle scripts, run the command above explicitly in build/deploy.

## API Routes

- `POST /api/search` -> start pipeline, return `search_id`
- `GET /api/search/:id/stream` -> SSE stage updates
- `GET /api/report/:id` -> report JSON by report id
- `GET /api/report/share/:token` -> report JSON by share token
- `POST /api/report/:id/pdf` -> full report PDF
- `POST /api/report/:id/memo` -> investment memo PDF
- `POST /api/advisor` -> advisor memo stream
- `POST /api/advisor/feedback` -> thumbs up/down feedback logging
- `POST /api/compare/:slugA/:slugB/pdf` -> comparison PDF
