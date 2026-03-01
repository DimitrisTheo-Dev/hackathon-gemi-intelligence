# GEMI Intelligence — Full Architecture Spec
### "Type any Greek company name → Full Due Diligence in 60 seconds"
**Stack:** Next.js 14 · Supabase · OpenAI GPT-4o · Playwright · TypeScript

---

## The Product in One Sentence

You type a company name. We hit GEMI (Greek public registry), extract everything public — structure, directors, shareholders, filings, capital history — run it through GPT-4o, and produce a structured due diligence report with a risk score. In under 60 seconds. For free. What currently costs €5,000 and 3 weeks.

---

## The Demo Moment (design for this first)

```
1. Open the app — one input, one button, nothing else
2. Type "COSMOTE" or any company the judges know
3. Watch the live status stages tick through:
   🔍 Searching GEMI registry...
   📋 Extracting company structure...
   👥 Mapping directors & shareholders...
   📄 Analysing filings & documents...
   🤖 AI building risk assessment...
   ✅ Report ready — 47 seconds

4. Beautiful report slides in:
   - Company card (name, type, status, capital, founded)
   - Ownership tree (shareholders + percentages)
   - Directors panel (names, roles, tenure, other directorships)
   - Filing timeline (what was filed, when, gaps flagged)
   - Risk score (0–10) with specific red flags called out
   - AI narrative paragraph: what a partner would write

5. Click "Export PDF" → professional report downloads
6. Click "Share" → unique URL, anyone can view it
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        NEXT.JS APP                                │
│                                                                    │
│   ┌─────────────────┐          ┌──────────────────────────────┐  │
│   │  Landing Page   │          │       Report Page            │  │
│   │  /             │          │  /report/[id]                │  │
│   │                 │          │                              │  │
│   │  [  Search  ]   │          │  Company Card                │  │
│   │  [ one input ]  │          │  Ownership Tree              │  │
│   │                 │          │  Directors                   │  │
│   └────────┬────────┘          │  Filings Timeline            │  │
│            │                   │  Risk Score + Flags          │  │
│            ▼                   │  AI Narrative                │  │
│   ┌─────────────────┐          │  Export PDF | Share          │  │
│   │  Loading Page   │          └──────────────────────────────┘  │
│   │  /search/[id]   │                                             │
│   │                 │                                             │
│   │  Live stages    │                                             │
│   │  SSE stream     │                                             │
│   └────────┬────────┘                                             │
└────────────│─────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────┐
│                     API LAYER (Next.js)                         │
│                                                                  │
│  POST /api/search     → kick off pipeline, return search_id     │
│  GET  /api/search/[id]/stream → SSE: live stage updates         │
│  GET  /api/report/[id]        → full report JSON                │
│  POST /api/report/[id]/pdf    → generate + return PDF           │
└────────────────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────┐
│                   PIPELINE (runs server-side)                   │
│                                                                  │
│  Step 1: GEMI Scraper (Playwright)                              │
│          └─ Search by name → get GEMI number                   │
│          └─ Company detail page → extract all fields           │
│          └─ Documents list → fetch filing metadata             │
│                                                                  │
│  Step 2: Enrichment                                             │
│          └─ News search (Bing/Google News API or SerpAPI)      │
│          └─ Director cross-reference (other GEMI roles)        │
│                                                                  │
│  Step 3: GPT-4o Synthesis                                       │
│          └─ Structured JSON report                             │
│          └─ Risk score + red flags                             │
│          └─ DD narrative paragraph                             │
│                                                                  │
│  Step 4: Persist to Supabase + emit SSE complete               │
└────────────────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                  │
│   searches table    reports table    report_cache table         │
└────────────────────────────────────────────────────────────────┘
```

---

## Data Sources

### Primary: GEMI (businessregistry.gr)
Public, no auth required. Contains:
- Company name, legal form, GEMI number, VAT (ΑΦΜ), status
- Registered address, activity code (ΚΑΔ)
- Share capital + history
- Directors: names, roles, appointment dates
- Shareholders (for non-listed companies)
- All filed documents: annual accounts, board resolutions, amendments
- Establishment date + any dissolution info

**Scraping approach:**
```
Search URL:  https://www.businessregistry.gr/pub/search/company?name={query}
Detail URL:  https://www.businessregistry.gr/pub/company/{gemi_number}
Docs URL:    https://www.businessregistry.gr/pub/company/{gemi_number}/documents
```
Use Playwright (headless Chromium). GEMI is a public service — scraping
is acceptable for a hackathon demo. Consider rate limiting (1 req/sec).

### Secondary: News Enrichment (optional, adds wow)
- SerpAPI Google News search: `"{company_name}" site:gr`
- Returns recent headlines → flag any litigation/scandal mentions
- Free tier: 100 searches/month (enough for demo)

### Tertiary: Director Cross-Reference
- For each director, run a second GEMI search by their name
- Returns all other companies they're registered with
- Huge DD value: "This director sits on 14 other boards, 3 dissolved"

---

## Database Schema

```sql
-- SEARCHES: tracks each pipeline run
CREATE TABLE searches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query         TEXT NOT NULL,                    -- user input
  gemi_number   TEXT,                             -- resolved GEMI number
  company_name  TEXT,                             -- resolved canonical name
  status        TEXT DEFAULT 'pending',           -- pending|scraping|enriching|analyzing|complete|failed
  current_stage TEXT,                             -- human-readable stage for SSE
  error         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- REPORTS: the final output
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id     UUID REFERENCES searches(id),
  gemi_number   TEXT UNIQUE,                      -- for cache lookup
  company_name  TEXT,
  report        JSONB NOT NULL,                   -- full structured report
  risk_score    INT,                              -- 0-10
  flags         TEXT[],                           -- array of red flag strings
  share_token   UUID DEFAULT gen_random_uuid(),   -- for shareable URL
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);
CREATE INDEX ON reports (gemi_number);
CREATE INDEX ON reports (share_token);

-- DIRECTOR CACHE: avoid re-scraping same directors
CREATE TABLE director_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  other_roles   JSONB,                            -- [{company, gemi_num, role, status}]
  cached_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON director_profiles (name);
```

---

## Report JSON Shape

```typescript
interface GEMIReport {
  company: {
    name: string
    legal_form: string           // ΑΕ | ΕΠΕ | ΙΚΕ | ΟΕ | ΕΕ | ΑΤΕΒΕ ...
    gemi_number: string
    vat: string
    status: 'active' | 'dissolved' | 'suspended' | 'unknown'
    address: string
    activity_code: string        // ΚΑΔ
    activity_description: string
    founded: string              // date
    dissolved?: string
  }

  capital: {
    current_amount: number
    currency: string
    last_changed: string
    history: Array<{ date: string; amount: number; change: string }>
  }

  directors: Array<{
    name: string
    role: string                 // Πρόεδρος | Διευθύνων Σύμβουλος | Μέλος ΔΣ
    appointed: string
    other_directorships: Array<{
      company: string
      gemi_number: string
      role: string
      status: 'active' | 'dissolved'
    }>
    flag?: string                // e.g. "Director of 3 dissolved companies"
  }>

  shareholders: Array<{
    name: string
    percentage: number
    entity_type: 'individual' | 'corporate' | 'unknown'
    jurisdiction?: string
  }>

  filings: Array<{
    type: string                 // annual_accounts | amendment | dissolution_notice
    date: string
    description: string
    gap_flag?: boolean           // true if previous year missing
  }>

  news: Array<{
    headline: string
    date: string
    source: string
    sentiment: 'neutral' | 'negative' | 'positive'
  }>

  risk: {
    score: number                // 0–10, higher = more risk
    flags: string[]              // specific red flags
    summary: string              // 2–3 sentence AI narrative
  }

  ai_narrative: string           // full DD paragraph, partner-level writing
  generated_at: string
}
```

---

## API Routes

### `POST /api/search`
```typescript
// Input
{ query: string }  // company name or GEMI number or VAT

// Output
{ search_id: string }

// Immediately kicks off pipeline as background task (no await)
// Client polls /api/search/[id]/stream via SSE
```

### `GET /api/search/[id]/stream`
```typescript
// Server-Sent Events stream
// Emits stage updates as pipeline progresses

data: { stage: "searching_gemi",   message: "Searching GEMI registry..." }
data: { stage: "extracting",       message: "Extracting company structure..." }
data: { stage: "directors",        message: "Mapping directors & shareholders..." }
data: { stage: "filings",          message: "Analysing 14 filed documents..." }
data: { stage: "news",             message: "Scanning recent news..." }
data: { stage: "ai_analysis",      message: "AI building risk assessment..." }
data: { stage: "complete",         report_id: "abc123" }
data: { stage: "error",            message: "Company not found in GEMI" }
```

### `GET /api/report/[id]`
```typescript
// Returns full GEMIReport JSON
// Also accessible via share_token: /api/report/share/[token]
```

### `POST /api/report/[id]/pdf`
```typescript
// Renders report to PDF via Puppeteer
// Returns PDF buffer, triggers download
```

---

## Pipeline Implementation

### Step 1: GEMI Scraper

```typescript
// lib/scraper/gemi.ts
import { chromium } from 'playwright'

export async function scrapeGEMI(query: string): Promise<GEMIRawData> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // 1. Search
  await page.goto(`https://www.businessregistry.gr/pub/search/company?name=${encodeURIComponent(query)}`)
  await page.waitForSelector('.company-result', { timeout: 10000 })

  // 2. Get first result GEMI number
  const gemiNumber = await page.$eval('.company-result:first-child [data-gemi]', el => el.getAttribute('data-gemi'))

  // 3. Company detail
  await page.goto(`https://www.businessregistry.gr/pub/company/${gemiNumber}`)
  await page.waitForSelector('.company-details')

  const rawData = await page.evaluate(() => {
    // Extract all visible fields from DOM
    return {
      name:          document.querySelector('.company-name')?.textContent?.trim(),
      legal_form:    document.querySelector('.legal-form')?.textContent?.trim(),
      status:        document.querySelector('.status')?.textContent?.trim(),
      address:       document.querySelector('.address')?.textContent?.trim(),
      vat:           document.querySelector('.vat')?.textContent?.trim(),
      capital:       document.querySelector('.capital')?.textContent?.trim(),
      founded:       document.querySelector('.founded-date')?.textContent?.trim(),
      directors:     Array.from(document.querySelectorAll('.director-row')).map(el => ({
                       name: el.querySelector('.director-name')?.textContent?.trim(),
                       role: el.querySelector('.director-role')?.textContent?.trim(),
                       appointed: el.querySelector('.appointed-date')?.textContent?.trim()
                     })),
      shareholders:  Array.from(document.querySelectorAll('.shareholder-row')).map(el => ({
                       name:       el.querySelector('.sh-name')?.textContent?.trim(),
                       percentage: el.querySelector('.sh-pct')?.textContent?.trim()
                     })),
    }
  })

  // 4. Documents list
  await page.goto(`https://www.businessregistry.gr/pub/company/${gemiNumber}/documents`)
  const filings = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.document-row')).map(el => ({
      type: el.querySelector('.doc-type')?.textContent?.trim(),
      date: el.querySelector('.doc-date')?.textContent?.trim(),
      description: el.querySelector('.doc-desc')?.textContent?.trim()
    }))
  )

  await browser.close()
  return { ...rawData, gemi_number: gemiNumber, filings }
}
```

> ⚠️ **Note:** The exact CSS selectors above are illustrative.
> On day 1 of the hackathon, spend 30 minutes inspecting the actual GEMI DOM
> and map real selectors. This is the only manual work in the whole pipeline.

### Step 2: Director Cross-Reference

```typescript
// lib/scraper/directors.ts
export async function enrichDirectors(directors: RawDirector[]) {
  return Promise.all(directors.map(async (director) => {
    // Search GEMI by director name → get all their registered roles
    const roles = await searchGEMIByPerson(director.name)
    const dissolved = roles.filter(r => r.status === 'dissolved')
    return {
      ...director,
      other_directorships: roles,
      flag: dissolved.length >= 2
        ? `Director of ${dissolved.length} dissolved companies`
        : undefined
    }
  }))
}
```

### Step 3: GPT-4o Synthesis

```typescript
// lib/ai/synthesize.ts
export async function synthesizeReport(rawData: GEMIRawData): Promise<GEMIReport> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [{
      role: 'system',
      content: `You are a senior M&A lawyer conducting due diligence on a Greek company.
                Analyse the provided GEMI registry data and produce a structured due diligence report.

                Assign a risk score 0-10 where:
                0-3 = low risk (clean structure, regular filings, no flags)
                4-6 = medium risk (some concerns worth noting)
                7-10 = high risk (serious red flags, recommend further investigation)

                Red flags to watch for:
                - Missing annual accounts for 2+ years
                - Capital decreases
                - Recent director changes (last 12 months)
                - Directors with multiple dissolved company associations
                - Offshore or opaque shareholders
                - Dormant status despite recent activity
                - Very recent incorporation (< 1 year) with large capital

                Return valid JSON matching the GEMIReport schema.
                Write the ai_narrative as a senior partner would write it — direct, specific, no fluff.`
    }, {
      role: 'user',
      content: `Analyse this company from GEMI:\n\n${JSON.stringify(rawData, null, 2)}`
    }]
  })

  return JSON.parse(completion.choices[0].message.content) as GEMIReport
}
```

### Step 4: Full Pipeline Orchestrator

```typescript
// lib/pipeline.ts
export async function runPipeline(searchId: string, query: string, emit: EmitFn) {
  try {
    emit('searching_gemi', 'Searching GEMI registry...')
    const rawData = await scrapeGEMI(query)
    await updateSearch(searchId, { gemi_number: rawData.gemi_number, status: 'scraping' })

    // Check cache — skip if we already have a fresh report
    const cached = await getCachedReport(rawData.gemi_number)
    if (cached) {
      emit('complete', 'Report ready (cached)', cached.id)
      return
    }

    emit('extracting', 'Extracting company structure...')
    // rawData already has structure from scrape

    emit('directors', `Mapping ${rawData.directors.length} directors & shareholders...`)
    const enrichedDirectors = await enrichDirectors(rawData.directors)
    rawData.directors = enrichedDirectors

    emit('filings', `Analysing ${rawData.filings.length} filed documents...`)
    const flaggedFilings = detectFilingGaps(rawData.filings)
    rawData.filings = flaggedFilings

    emit('news', 'Scanning recent news...')
    const news = await fetchRecentNews(rawData.company_name)
    rawData.news = news

    emit('ai_analysis', 'AI building risk assessment...')
    const report = await synthesizeReport(rawData)

    const saved = await saveReport(searchId, report)
    emit('complete', 'Report ready', saved.id)

  } catch (err) {
    await updateSearch(searchId, { status: 'failed', error: String(err) })
    emit('error', `Failed: ${String(err)}`)
  }
}
```

---

## Next.js App Structure

```
src/
├── app/
│   ├── page.tsx                    ← Landing: one search input
│   ├── search/
│   │   └── [id]/
│   │       └── page.tsx            ← Loading: SSE stage display
│   ├── report/
│   │   ├── [id]/
│   │   │   └── page.tsx            ← Full report view
│   │   └── share/
│   │       └── [token]/
│   │           └── page.tsx        ← Shareable public view
│   └── api/
│       ├── search/
│       │   ├── route.ts            ← POST: start pipeline
│       │   └── [id]/
│       │       └── stream/
│       │           └── route.ts    ← GET: SSE stream
│       └── report/
│           ├── [id]/
│           │   └── route.ts        ← GET: full report
│           └── [id]/
│               └── pdf/
│                   └── route.ts    ← POST: PDF export
│
├── components/
│   ├── search/
│   │   ├── SearchInput.tsx         ← Hero input + submit
│   │   └── SearchExamples.tsx      ← "Try: COSMOTE, ΒΙΟΧΑΛΚΟ..."
│   ├── loading/
│   │   └── PipelineStages.tsx      ← Animated stage checklist
│   └── report/
│       ├── CompanyCard.tsx         ← Name, type, status, capital, badge
│       ├── RiskScore.tsx           ← Big number + color + flags list
│       ├── OwnershipTree.tsx       ← Visual shareholder tree (D3 or simple)
│       ├── DirectorsPanel.tsx      ← Directors + other directorships
│       ├── FilingsTimeline.tsx     ← Chronological filing list + gap flags
│       ├── NewsPanel.tsx           ← Recent headlines with sentiment
│       ├── AINarrative.tsx         ← The full partner-level paragraph
│       └── ExportBar.tsx           ← PDF button + Share link
│
└── lib/
    ├── scraper/
    │   ├── gemi.ts                 ← Playwright GEMI scraper
    │   └── directors.ts            ← Director cross-reference
    ├── ai/
    │   └── synthesize.ts           ← GPT-4o synthesis
    ├── enrichment/
    │   └── news.ts                 ← SerpAPI news fetch
    ├── pipeline.ts                 ← Full orchestrator
    └── supabase.ts                 ← DB helpers
```

---

## UI Design Principles

**Landing page:** Dead simple. Black background. One large input. Examples below it ("Try: COSMOTE, ΒΙΟΧΑΛΚΟ, MYTILINEOS"). Nothing else. No nav, no footer, no fluff.

**Loading page:** Full screen. Company name at top. Animated checklist of stages. Each stage ticks green as it completes. Show elapsed time. Progress bar at bottom. This screen IS the demo — it communicates exactly what's happening.

**Report page:** Dark card-based layout. Risk score is the first thing you see — large, colored (green/amber/red). Then company basics. Then the red flags as chips. Then the AI narrative. Then the detail panels (directors, shareholders, filings). PDF/Share buttons sticky at bottom.

**Key visual:** The risk score meter. A large `7/10` in red with 3 specific flags listed beneath it — that's the screenshot that wins demos.

---

## 24-Hour Build Plan

```
Hour 0–1    Project bootstrap
            npx create-next-app@latest gemi-intelligence --typescript --tailwind --app
            Supabase project creation, schema migration
            Install: playwright, openai, @supabase/supabase-js, resend (if needed)
            .env.local setup

Hour 1–3    GEMI scraper (most critical, do this first)
            Manually inspect businessregistry.gr DOM in browser
            Map CSS selectors for: company detail, directors, shareholders, filings
            Build + test scrapeGEMI() with 3 real companies
            Verify data quality before building anything else

Hour 3–5    Pipeline + API
            POST /api/search → kick off pipeline
            GET /api/search/[id]/stream → SSE emitter
            Full pipeline.ts orchestrator with stage emissions
            Supabase persistence

Hour 5–7    GPT-4o synthesis
            Build synthesize.ts with structured JSON output
            Tune system prompt with real scraped data
            Test risk score calibration on 3 companies

Hour 7–10   Core UI
            Landing page (search input, examples)
            Loading page (SSE consumer, animated stages)
            Report page (all panels, rough layout)

Hour 10–14  Report UI polish
            Risk score visual (the hero element)
            Director cross-reference display
            Filing timeline with gap flags
            Company status badge

Hour 14–17  PDF export
            Use @react-pdf/renderer or puppeteer screenshot
            Match visual design of web report
            Download triggers correctly

Hour 17–19  Share link
            Unique token → public route
            No auth required to view shared report

Hour 19–21  Edge cases + error states
            Company not found → graceful error
            GEMI timeout → fallback message
            Rate limiting (multiple tabs open during demo)

Hour 21–24  Demo prep
            Pre-cache 5 company reports (so demo is instant)
            Rehearse the 60-second demo flow
            Deploy to Vercel (one command)
            Test on mobile (judges may look over shoulder)
```

---

## Setup Checklist (Day 0 — Do This Before Writing Code)

```bash
# 1. Create Next.js app
pnpm create next-app@latest gemi-intelligence \
  --typescript --tailwind --app --no-src-dir --import-alias "@/*"

# 2. Install dependencies
pnpm add playwright @playwright/browser-chromium openai @supabase/supabase-js
pnpm add @react-pdf/renderer     # PDF export
pnpm add zustand                 # state management
pnpm add lucide-react            # icons

# 3. Install shadcn/ui
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add card badge button progress separator

# 4. Supabase
# - Create project at supabase.com
# - Run schema SQL from this doc in SQL editor
# - Copy SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY

# 5. OpenAI
# - Get API key at platform.openai.com
# - Confirm GPT-4o access

# 6. Playwright browsers
pnpm exec playwright install chromium

# 7. .env.local
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://zojlkfvcnfksselxclhg.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_NXRmoVoFJNNy40Y6vcOyQQ_TrAHGfdK
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SERPAPI_KEY=...   # optional, for news enrichment
```

---

## The 5-Second Pitch

> "Due diligence on a Greek company costs €15,000 and takes 6 weeks.
> We do it in 60 seconds. From public data. For free.
> Type any company name."

Then you hand the laptop to a judge.
