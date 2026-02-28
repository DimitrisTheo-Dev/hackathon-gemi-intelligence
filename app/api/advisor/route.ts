import { createHash } from "crypto";

import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  buildAdvisorScenario,
  buildAdvisorUserPrompt,
  buildDeterministicAdvisorMemo,
  parseVerdictFromMemo,
  type AdvisorMetadata,
  type AdvisorVerdict,
} from "@/lib/advisor";
import { env } from "@/lib/env";
import { applyRateLimitHeaders, createRateLimiter, rateLimitExceededResponse } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { GEMIReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const advisorRateLimiter = createRateLimiter({
  namespace: "api-advisor",
  limit: 20,
  windowMs: 5 * 60 * 1000,
});

const ADVISOR_SYSTEM_PROMPT = `You are a senior investment analyst and corporate risk advisor with 20 years of experience
in Greek and European markets. You have just completed a due diligence review of a company
using structured data extracted directly from the GEMI business registry and official
financial filings.

Your job is to deliver a concise, decisive advisory memo - not a data summary.
The data has already been processed. Your job is interpretation and recommendation.

Rules you must follow:
- Always open with a clear verdict: PROCEED / PROCEED WITH CONDITIONS / DO NOT PROCEED
- Never say "it depends", "consult a professional", or "further research may be needed" as a cop-out
- You may say "conditional on X" but you must specify X precisely
- Write in second person ("I recommend", "my assessment", "in my view")
- Be direct, be opinionated, be useful
- Maximum 280 words
- Structure: Verdict -> Key Concerns (2-3 bullets) -> Redeeming Factors (1-2 bullets, if any) -> Final Recommendation
- If risk score is above 7, you are not allowed to recommend PROCEED without conditions
- Tone: confident senior analyst, not a chatbot`;

interface AdvisorRequest {
  companySlug?: string;
  reportData?: GEMIReport;
  resolved_flag_ids?: string[];
  scenario_label?: string;
}

interface AdvisorCacheEntry {
  company_slug: string;
  cache_key: string;
  verdict: AdvisorVerdict;
  memo: string;
  generated_by: "ai" | "deterministic";
  metadata: AdvisorMetadata;
  created_at: string;
  expires_at: string;
}

const memoryCache = new Map<string, AdvisorCacheEntry>();

function normalizeVerdictLabel(verdict: AdvisorVerdict): string {
  if (verdict === "DO_NOT_PROCEED") return "DO NOT PROCEED";
  if (verdict === "PROCEED_WITH_CONDITIONS") return "PROCEED WITH CONDITIONS";
  return "PROCEED";
}

function normalizeCompanySlug(value: string | undefined, report: GEMIReport): string {
  const base = value?.trim() || report.company.gemi_number || report.company.name;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildCacheKey(report: GEMIReport, resolvedFlagIds: string[], companySlug: string): string {
  const fingerprint = {
    companySlug,
    gemi: report.company.gemi_number,
    riskScore: report.risk.score,
    confidence: report.risk.confidence,
    generatedAt: report.generated_at,
    sourceQuality: report.source_quality,
    flags: (report.risk.evidence_flags || []).map((flag) => ({
      id: flag.id,
      label: flag.label,
      severity: flag.severity,
      scoreImpact: flag.score_impact || 0,
      evidence: flag.evidence.map((item) => ({
        label: item.label,
        reference: item.reference,
        date: item.date,
      })),
    })),
    resolved: [...new Set(resolvedFlagIds)].sort(),
  };

  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}

function enforceVerdictPolicy(
  memo: string,
  score: number,
  fallbackVerdict: AdvisorVerdict,
): { memo: string; verdict: AdvisorVerdict } {
  let verdict = parseVerdictFromMemo(memo) || fallbackVerdict;
  if (score > 7 && verdict === "PROCEED") {
    verdict = "PROCEED_WITH_CONDITIONS";
  }

  const heading = `Verdict: ${normalizeVerdictLabel(verdict)}`;
  const hasVerdictHeading = /^Verdict:/i.test(memo.trim());
  const normalizedMemo = hasVerdictHeading ? memo.trim() : `${heading}\n${memo.trim()}`;

  return {
    memo: normalizedMemo,
    verdict,
  };
}

function validateMemoShape(memo: string): boolean {
  if (!memo || memo.trim().length < 90) {
    return false;
  }

  const normalized = memo.toLowerCase();
  return (
    normalized.includes("verdict") &&
    normalized.includes("key concerns") &&
    normalized.includes("final recommendation")
  );
}

async function generateWithOpenAI(prompt: string): Promise<string | null> {
  if (!env.openAiApiKey) {
    return null;
  }

  const client = new OpenAI({ apiKey: env.openAiApiKey, timeout: 25000 });
  const completion = await client.chat.completions.create({
    model: env.openAiModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: ADVISOR_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || null;
}

async function generateWithGemini(prompt: string): Promise<string | null> {
  if (!env.geminiApiKey) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    env.geminiModel,
  )}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.geminiApiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${ADVISOR_SYSTEM_PROMPT}\n\n${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (!response.ok) {
    return null;
  }

  return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function generateAdvisorMemo(
  report: GEMIReport,
  resolvedFlagIds: string[],
): Promise<{
  verdict: AdvisorVerdict;
  memo: string;
  generatedBy: "ai" | "deterministic";
  metadata: AdvisorMetadata;
}> {
  const deterministic = buildDeterministicAdvisorMemo(report, resolvedFlagIds);
  const prompt = buildAdvisorUserPrompt(report, resolvedFlagIds);
  const scenario = buildAdvisorScenario(report, resolvedFlagIds);

  try {
    const primary = env.geminiApiKey
      ? await generateWithGemini(prompt)
      : await generateWithOpenAI(prompt);
    const candidate = primary || (env.geminiApiKey ? await generateWithOpenAI(prompt) : await generateWithGemini(prompt));

    if (candidate && validateMemoShape(candidate)) {
      const normalized = enforceVerdictPolicy(candidate, scenario.score, deterministic.verdict);
      return {
        verdict: normalized.verdict,
        memo: normalized.memo,
        generatedBy: "ai",
        metadata: {
          ...deterministic.metadata,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  } catch {
    // Deterministic fallback below.
  }

  const normalizedDeterministic = enforceVerdictPolicy(
    deterministic.memo,
    scenario.score,
    deterministic.verdict,
  );

  return {
    verdict: normalizedDeterministic.verdict,
    memo: normalizedDeterministic.memo,
    generatedBy: "deterministic",
    metadata: deterministic.metadata,
  };
}

async function getCachedEntry(cacheKey: string): Promise<AdvisorCacheEntry | null> {
  const local = memoryCache.get(cacheKey);
  if (local && Date.parse(local.expires_at) > Date.now()) {
    return local;
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return null;
  }

  try {
    const nowIso = new Date().toISOString();
    const { data } = await client
      .from("advisor_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (!data) {
      return null;
    }

    const entry = data as AdvisorCacheEntry;
    memoryCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

async function saveCacheEntry(entry: AdvisorCacheEntry): Promise<void> {
  memoryCache.set(entry.cache_key, entry);
  const client = getSupabaseServerClient();
  if (!client) {
    return;
  }

  try {
    await client.from("advisor_cache").upsert(entry, { onConflict: "cache_key" });
  } catch {
    // Ignore cache persistence failures.
  }
}

function streamAdvisorPayload(payload: {
  verdict: AdvisorVerdict;
  memo: string;
  generatedBy: "ai" | "deterministic";
  metadata: AdvisorMetadata;
  scenarioLabel?: string;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (value: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      };

      enqueue({
        type: "meta",
        verdict: payload.verdict,
        generatedBy: payload.generatedBy,
        metadata: payload.metadata,
        scenarioLabel: payload.scenarioLabel,
      });

      const words = payload.memo.split(/\s+/).filter(Boolean);
      let assembled = "";

      for (let index = 0; index < words.length; index += 1) {
        const chunk = `${words[index]}${index < words.length - 1 ? " " : ""}`;
        assembled += chunk;
        enqueue({
          type: "delta",
          text: chunk,
        });

        if (payload.generatedBy === "ai") {
          await new Promise((resolve) => setTimeout(resolve, 7));
        }
      }

      enqueue({
        type: "done",
        verdict: payload.verdict,
        generatedBy: payload.generatedBy,
        memo: assembled,
        metadata: payload.metadata,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const rateState = advisorRateLimiter.check(request);
  if (!rateState.allowed) {
    return rateLimitExceededResponse(rateState, "advisor");
  }

  const payload = (await request.json().catch(() => ({}))) as AdvisorRequest;
  const report = payload.reportData;

  if (!report || !report.company?.name) {
    const response = NextResponse.json({ error: "Valid reportData is required." }, { status: 400 });
    return applyRateLimitHeaders(response, rateState);
  }

  const resolvedFlagIds = Array.isArray(payload.resolved_flag_ids)
    ? payload.resolved_flag_ids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const scenario = buildAdvisorScenario(report, resolvedFlagIds);
  const companySlug = normalizeCompanySlug(payload.companySlug, report);
  const cacheKey = buildCacheKey(report, resolvedFlagIds, companySlug);

  const cached = await getCachedEntry(cacheKey);
  if (cached) {
    const response = streamAdvisorPayload({
      verdict: cached.verdict,
      memo: cached.memo,
      generatedBy: cached.generated_by,
      metadata: cached.metadata,
      scenarioLabel: payload.scenario_label,
    });
    return applyRateLimitHeaders(response, rateState);
  }

  const generated = await generateAdvisorMemo(report, resolvedFlagIds);
  let verdict = generated.verdict;
  if (scenario.score > 7 && verdict === "PROCEED") {
    verdict = "PROCEED_WITH_CONDITIONS";
  }
  if (!generated.memo.trim().toUpperCase().includes(normalizeVerdictLabel(verdict))) {
    generated.memo = `Verdict: ${normalizeVerdictLabel(verdict)}\n${generated.memo.trim()}`;
  }

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await saveCacheEntry({
    company_slug: companySlug,
    cache_key: cacheKey,
    verdict,
    memo: generated.memo,
    generated_by: generated.generatedBy,
    metadata: generated.metadata,
    created_at: nowIso,
    expires_at: expiresAt,
  });

  const response = streamAdvisorPayload({
    verdict,
    memo: generated.memo,
    generatedBy: generated.generatedBy,
    metadata: generated.metadata,
    scenarioLabel: payload.scenario_label,
  });
  return applyRateLimitHeaders(response, rateState);
}
