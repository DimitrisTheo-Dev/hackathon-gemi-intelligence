import { NextResponse } from "next/server";

import { applyRateLimitHeaders, createRateLimiter, rateLimitExceededResponse } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const advisorFeedbackRateLimiter = createRateLimiter({
  namespace: "api-advisor-feedback",
  limit: 30,
  windowMs: 5 * 60 * 1000,
});

interface AdvisorFeedbackRequest {
  company_slug?: string;
  verdict?: string;
  rating?: "up" | "down";
}

const feedbackMemory: Array<{
  company_slug: string;
  verdict: string;
  rating: "up" | "down";
  created_at: string;
}> = [];

export async function POST(request: Request): Promise<NextResponse> {
  const rateState = advisorFeedbackRateLimiter.check(request);
  if (!rateState.allowed) {
    return rateLimitExceededResponse(rateState, "advisor feedback");
  }

  const payload = (await request.json().catch(() => ({}))) as AdvisorFeedbackRequest;
  const companySlug = String(payload.company_slug || "").trim().toLowerCase();
  const verdict = String(payload.verdict || "").trim().toUpperCase();
  const rating: "up" | "down" | null =
    payload.rating === "down" ? "down" : payload.rating === "up" ? "up" : null;

  if (!companySlug || !verdict || !rating) {
    const response = NextResponse.json(
      { error: "company_slug, verdict, and rating are required." },
      { status: 400 },
    );
    return applyRateLimitHeaders(response, rateState);
  }

  const record = {
    company_slug: companySlug,
    verdict,
    rating,
    created_at: new Date().toISOString(),
  };

  feedbackMemory.push(record);

  const client = getSupabaseServerClient();
  if (client) {
    try {
      await client.from("advisor_feedback").insert(record);
    } catch {
      // Ignore persistence failures in demo mode.
    }
  }

  const response = NextResponse.json({ ok: true });
  return applyRateLimitHeaders(response, rateState);
}
