import { NextResponse } from "next/server";

import {
  getLatestSearchEvent,
  getSearch,
  subscribeToSearch,
} from "@/lib/store";
import type { SearchEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stageFromSearch(
  status: string,
  message: string,
): { stage: SearchEvent["stage"]; progress: number } {
  const normalized = message.toLowerCase();

  if (status === "failed") {
    return { stage: "error", progress: 100 };
  }

  if (status === "complete") {
    return { stage: "complete", progress: 100 };
  }

  if (status === "analyzing" || normalized.includes("ai")) {
    return { stage: "ai_analysis", progress: 90 };
  }

  if (normalized.includes("news")) {
    return { stage: "news", progress: 78 };
  }

  if (
    normalized.includes("filing") ||
    normalized.includes("document") ||
    normalized.includes("financial statement pdf") ||
    normalized.includes("signature")
  ) {
    return { stage: "filings", progress: 66 };
  }

  if (normalized.includes("director") || normalized.includes("shareholder")) {
    return { stage: "directors", progress: 48 };
  }

  if (normalized.includes("extract")) {
    return { stage: "extracting", progress: 30 };
  }

  return { stage: "searching_gemi", progress: 10 };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const search = await getSearch(id);

  if (!search) {
    return NextResponse.json({ error: "Search not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup = (): void => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: SearchEvent): void => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const close = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      const latest = getLatestSearchEvent(id);
      const terminalFromSearch =
        search.status === "complete"
          ? ({
              stage: "complete",
              message: search.current_stage || "Report ready",
              progress: 100,
              timestamp: new Date().toISOString(),
              report_id: search.report_id,
            } satisfies SearchEvent)
          : search.status === "failed"
            ? ({
                stage: "error",
                message: search.error || search.current_stage || "Pipeline failed.",
                progress: 100,
                timestamp: new Date().toISOString(),
                report_id: search.report_id,
              } satisfies SearchEvent)
            : null;

      const initialEvent =
        terminalFromSearch ??
        (latest
          ? {
              ...latest,
              report_id: latest.report_id ?? search.report_id,
            }
          : (() => {
              const derived = stageFromSearch(search.status, search.current_stage || "Preparing pipeline...");
              return {
                stage: derived.stage,
                message: search.current_stage || "Preparing pipeline...",
                progress: derived.progress,
                timestamp: new Date().toISOString(),
                report_id: search.report_id,
              } satisfies SearchEvent;
            })());

      send(initialEvent);

      if (initialEvent.stage === "complete" || initialEvent.stage === "error") {
        close();
        return;
      }

      let lastSignature = `${initialEvent.stage}|${initialEvent.message}|${initialEvent.report_id ?? ""}`;

      const unsubscribe = subscribeToSearch(id, (event) => {
        lastSignature = `${event.stage}|${event.message}|${event.report_id ?? ""}`;
        send(event);

        if (event.stage === "complete" || event.stage === "error") {
          setTimeout(() => close(), 250);
        }
      });

      const poller = setInterval(async () => {
        const current = await getSearch(id);
        if (!current) {
          return;
        }

        const derived = stageFromSearch(current.status, current.current_stage || "");
        const event: SearchEvent = {
          stage: derived.stage,
          message: current.current_stage || "Pipeline running...",
          progress: derived.progress,
          timestamp: new Date().toISOString(),
          report_id: current.report_id,
        };

        const signature = `${event.stage}|${event.message}|${event.report_id ?? ""}`;
        if (signature !== lastSignature) {
          lastSignature = signature;
          send(event);
        }

        if (event.stage === "complete" || event.stage === "error") {
          setTimeout(() => close(), 200);
        }
      }, 800);

      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(poller);
        unsubscribe();
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
