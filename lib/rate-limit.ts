import { NextResponse } from "next/server";

interface RateLimitBucket {
  count: number;
  resetAt: number;
  lastSeen: number;
}

export interface RateLimitState {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, RateLimitBucket>();

function nowMs(): number {
  return Date.now();
}

function cleanupExpired(now: number): void {
  if (buckets.size < 4000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now && now - bucket.lastSeen > 10 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function getClientIp(request: Request): string {
  const headers = request.headers;
  return (
    firstHeaderValue(headers.get("x-forwarded-for")) ||
    firstHeaderValue(headers.get("x-real-ip")) ||
    firstHeaderValue(headers.get("cf-connecting-ip")) ||
    "unknown"
  );
}

export function createRateLimiter(options: {
  namespace: string;
  limit: number;
  windowMs: number;
}) {
  const { namespace, limit, windowMs } = options;

  return {
    check(request: Request): RateLimitState {
      const now = nowMs();
      cleanupExpired(now);

      const ip = getClientIp(request);
      const key = `${namespace}:${ip}`;
      const existing = buckets.get(key);

      let bucket: RateLimitBucket;
      if (!existing || existing.resetAt <= now) {
        bucket = {
          count: 1,
          resetAt: now + windowMs,
          lastSeen: now,
        };
        buckets.set(key, bucket);
      } else {
        existing.count += 1;
        existing.lastSeen = now;
        bucket = existing;
      }

      const remaining = Math.max(0, limit - bucket.count);
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

      return {
        allowed: bucket.count <= limit,
        limit,
        remaining,
        resetAt: bucket.resetAt,
        retryAfterSeconds,
      };
    },
  };
}

export function applyRateLimitHeaders<T extends Response>(response: T, state: RateLimitState): T {
  response.headers.set("X-RateLimit-Limit", String(state.limit));
  response.headers.set("X-RateLimit-Remaining", String(state.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.floor(state.resetAt / 1000)));
  return response;
}

export function rateLimitExceededResponse(state: RateLimitState, routeLabel: string): NextResponse {
  const response = NextResponse.json(
    {
      error: `Rate limit exceeded for ${routeLabel}. Try again in ${state.retryAfterSeconds} seconds.`,
    },
    { status: 429 },
  );
  response.headers.set("Retry-After", String(state.retryAfterSeconds));
  return applyRateLimitHeaders(response, state);
}
