"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { PipelineStage, SearchEvent } from "@/lib/types";

const stages: Array<{ id: PipelineStage; title: string }> = [
  { id: "searching_gemi", title: "Searching GEMI registry" },
  { id: "extracting", title: "Extracting company structure" },
  { id: "directors", title: "Mapping directors and shareholders" },
  { id: "filings", title: "Analyzing filings and documents" },
  { id: "news", title: "Scanning recent news" },
  { id: "ai_analysis", title: "Building AI risk assessment" },
];

function stageIndex(stage: PipelineStage | null): number {
  if (!stage) {
    return 0;
  }

  const idx = stages.findIndex((item) => item.id === stage);
  return idx < 0 ? 0 : idx + 1;
}

export default function LoadingPipeline({ searchId }: { searchId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compareWith = searchParams.get("compare_with");

  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [activeStage, setActiveStage] = useState<PipelineStage | null>("searching_gemi");
  const [message, setMessage] = useState("Preparing pipeline...");
  const [progress, setProgress] = useState(4);
  const [completed, setCompleted] = useState<Set<PipelineStage>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/search/${searchId}/stream`);

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as SearchEvent;
      setError(null);

      setActiveStage(payload.stage);
      setMessage(payload.message);
      setProgress(payload.progress);

      if (payload.stage !== "error" && payload.stage !== "complete") {
        setCompleted((current) => {
          const next = new Set(current);
          const index = stageIndex(payload.stage);
          for (let i = 0; i < index - 1; i += 1) {
            next.add(stages[i].id);
          }
          return next;
        });
      }

      if (payload.stage === "complete") {
        setCompleted(new Set(stages.map((stage) => stage.id)));
        setProgress(100);
        eventSource.close();
        setTimeout(() => {
          if (payload.report_id) {
            if (compareWith) {
              router.push(`/compare/${compareWith}/${payload.report_id}`);
              return;
            }
            router.push(`/report/${payload.report_id}`);
          } else {
            router.push("/");
          }
        }, 600);
      }

      if (payload.stage === "error") {
        setError(payload.message || "Pipeline failed.");
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError("Connection to pipeline interrupted. Reconnecting...");
    };

    return () => {
      eventSource.close();
    };
  }, [compareWith, router, searchId]);

  const elapsedLabel = useMemo(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsedMs]);

  return (
    <main className="loading-shell">
      <div className="loading-grid" aria-hidden />
      <section className="loading-card">
        <div className="loading-top">
          <p className="eyebrow">GEMI Intelligence Pipeline</p>
          <h1>Building report for Search #{searchId.slice(0, 8)}</h1>
          <p className="subline">Elapsed time: {elapsedLabel}</p>
        </div>

        <ul className="stage-list">
          {stages.map((stage) => {
            const isComplete = completed.has(stage.id);
            const isActive = activeStage === stage.id;

            return (
              <li key={stage.id} className={`stage-item ${isActive ? "active" : ""}`}>
                <span className={`stage-icon ${isComplete ? "done" : isActive ? "run" : "idle"}`}>
                  {isComplete ? (
                    <CheckCircle2 size={16} />
                  ) : isActive ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Circle size={16} />
                  )}
                </span>
                <span>{stage.title}</span>
              </li>
            );
          })}
        </ul>

        <div className="progress-wrap" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="progress-bar" style={{ width: `${Math.max(4, progress)}%` }} />
        </div>

        <p className={`pipeline-message ${error ? "error" : ""}`}>{error ?? message}</p>
      </section>
    </main>
  );
}
