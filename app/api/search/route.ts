import { after, NextResponse } from "next/server";

import { normalizeUserApiKeys } from "@/lib/api-keys";
import { runPipeline } from "@/lib/pipeline";
import { applyRateLimitHeaders, createRateLimiter, rateLimitExceededResponse } from "@/lib/rate-limit";
import { lookupGEMICandidates } from "@/lib/scraper/gemi";
import { createSearch } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const searchRateLimiter = createRateLimiter({
  namespace: "api-search",
  limit: 10,
  windowMs: 5 * 60 * 1000,
});

export async function POST(request: Request): Promise<NextResponse> {
  const rateState = searchRateLimiter.check(request);
  if (!rateState.allowed) {
    return rateLimitExceededResponse(rateState, "search");
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as {
      query?: string;
      selected_gemi?: string;
      api_keys?: unknown;
    };
    const query = payload.query?.trim();
    const selectedGemi = payload.selected_gemi?.replace(/\D+/g, "") || "";
    const apiKeys = normalizeUserApiKeys(payload.api_keys);

    if (!query) {
      const response = NextResponse.json({ error: "Query is required." }, { status: 400 });
      return applyRateLimitHeaders(response, rateState);
    }

    if (!selectedGemi) {
      try {
        const candidateLookup = await lookupGEMICandidates(query, 6);

        if (candidateLookup.candidates.length > 1) {
          const response = NextResponse.json({
            requires_selection: true,
            candidates: candidateLookup.candidates,
          });
          return applyRateLimitHeaders(response, rateState);
        }
      } catch {
        // Ignore candidate lookup errors and continue with best-effort pipeline run.
      }
    }

    const search = await createSearch(query);
    const pipelineQuery = selectedGemi || query;

    try {
      after(async () => {
        await runPipeline(search.id, pipelineQuery, apiKeys).catch((error) => {
          console.error("Pipeline failed", error);
        });
      });
    } catch (afterError) {
      console.error("[api/search] after() not supported, running pipeline inline:", afterError);
      runPipeline(search.id, pipelineQuery, apiKeys).catch((error) => {
        console.error("Pipeline failed (inline):", error);
      });
    }

    const response = NextResponse.json({ search_id: search.id });
    return applyRateLimitHeaders(response, rateState);
  } catch (error) {
    console.error("[api/search] unhandled error:", error);
    const response = NextResponse.json(
      { error: "Unable to launch due diligence pipeline. Please retry." },
      { status: 500 },
    );
    return applyRateLimitHeaders(response, rateState);
  }
}
