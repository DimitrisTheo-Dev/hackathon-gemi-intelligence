"use client";

import { CheckCircle2, Copy, Info, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { GEMIReport } from "@/lib/types";

interface AdvisorResponseMetadata {
  evidencePoints: number;
  filingsParsed: number;
  pdfScanned: number;
  generatedAt: string;
}

type AdvisorVerdict = "PROCEED" | "PROCEED_WITH_CONDITIONS" | "DO_NOT_PROCEED";

interface AdvisorPacket {
  includeInPdf: boolean;
  verdict: AdvisorVerdict;
  memo: string;
  generatedBy: "ai" | "deterministic";
  metadata: AdvisorResponseMetadata;
}

interface AIAdvisorProps {
  companySlug: string;
  reportData: GEMIReport;
  resolvedFlagIds: string[];
  onMemoChange?: (packet: AdvisorPacket) => void;
}

interface ParsedMemo {
  verdictLine: string;
  keyConcerns: string[];
  redeemingFactors: string[];
  recommendation: string;
}

function normalizeVerdictLabel(verdict: AdvisorVerdict): string {
  if (verdict === "DO_NOT_PROCEED") return "DO NOT PROCEED";
  if (verdict === "PROCEED_WITH_CONDITIONS") return "PROCEED WITH CONDITIONS";
  return "PROCEED";
}

function verdictTone(verdict: AdvisorVerdict): "low" | "medium" | "high" {
  if (verdict === "PROCEED") return "low";
  if (verdict === "PROCEED_WITH_CONDITIONS") return "medium";
  return "high";
}

function parseMemo(memo: string, verdict: AdvisorVerdict): ParsedMemo {
  const lines = memo
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result: ParsedMemo = {
    verdictLine: `Verdict: ${normalizeVerdictLabel(verdict)}`,
    keyConcerns: [],
    redeemingFactors: [],
    recommendation: "",
  };

  let section: "none" | "concerns" | "redeeming" | "final" = "none";

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("verdict:")) {
      result.verdictLine = line;
      section = "none";
      continue;
    }
    if (lower.startsWith("key concerns")) {
      section = "concerns";
      continue;
    }
    if (lower.startsWith("redeeming factors")) {
      section = "redeeming";
      continue;
    }
    if (lower.startsWith("final recommendation")) {
      section = "final";
      continue;
    }

    const cleaned = line.replace(/^[-*]\s*/, "");
    if (section === "concerns") {
      result.keyConcerns.push(cleaned);
      continue;
    }
    if (section === "redeeming") {
      result.redeemingFactors.push(cleaned);
      continue;
    }
    if (section === "final") {
      result.recommendation = result.recommendation
        ? `${result.recommendation} ${cleaned}`
        : cleaned;
    }
  }

  if (!result.recommendation) {
    result.recommendation = lines.slice(-1)[0] || memo;
  }

  return result;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value || "n/a";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export default function AIAdvisor({
  companySlug,
  reportData,
  resolvedFlagIds,
  onMemoChange,
}: AIAdvisorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [verdict, setVerdict] = useState<AdvisorVerdict>("PROCEED_WITH_CONDITIONS");
  const [generatedBy, setGeneratedBy] = useState<"ai" | "deterministic">("deterministic");
  const [metadata, setMetadata] = useState<AdvisorResponseMetadata>({
    evidencePoints: reportData.source_quality?.evidence_points ?? 0,
    filingsParsed: reportData.source_quality?.filings_parsed ?? reportData.filings.length,
    pdfScanned:
      reportData.source_quality?.pdfs_scanned ??
      reportData.financials
        .filter((item) => Boolean(item.download_url) && Boolean(item.filename))
        .slice(0, 4).length,
    generatedAt: reportData.generated_at,
  });
  const [includeInPdf, setIncludeInPdf] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");
  const [feedbackState, setFeedbackState] = useState<"idle" | "up" | "down">("idle");

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        companySlug,
        generatedAt: reportData.generated_at,
        score: reportData.risk.score,
        resolved: [...resolvedFlagIds].sort(),
      }),
    [companySlug, reportData.generated_at, reportData.risk.score, resolvedFlagIds],
  );

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setLoading(true);
      setError(null);
      setMemo("");
      setFeedbackState("idle");

      try {
        const response = await fetch("/api/advisor", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            companySlug,
            reportData,
            resolved_flag_ids: resolvedFlagIds,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Advisor generation failed.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }

            const packet = JSON.parse(trimmed) as
              | {
                  type: "meta";
                  verdict: AdvisorVerdict;
                  generatedBy: "ai" | "deterministic";
                  metadata: AdvisorResponseMetadata;
                }
              | {
                  type: "delta";
                  text: string;
                }
              | {
                  type: "done";
                  verdict: AdvisorVerdict;
                  generatedBy: "ai" | "deterministic";
                  memo: string;
                  metadata: AdvisorResponseMetadata;
                };

            if (packet.type === "meta") {
              if (cancelled) return;
              setVerdict(packet.verdict);
              setGeneratedBy(packet.generatedBy);
              setMetadata(packet.metadata);
              continue;
            }

            if (packet.type === "delta") {
              if (cancelled) return;
              setMemo((current) => `${current}${packet.text}`);
              continue;
            }

            if (packet.type === "done") {
              if (cancelled) return;
              setVerdict(packet.verdict);
              setGeneratedBy(packet.generatedBy);
              setMetadata(packet.metadata);
              setMemo(packet.memo);
            }
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Advisor generation failed.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run().catch(() => {
      if (!cancelled) {
        setError("Advisor generation failed.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fingerprint, companySlug, reportData, resolvedFlagIds]);

  useEffect(() => {
    if (!memo.trim()) {
      return;
    }

    onMemoChange?.({
      includeInPdf,
      verdict,
      memo,
      generatedBy,
      metadata,
    });
  }, [generatedBy, includeInPdf, memo, metadata, onMemoChange, verdict]);

  async function onCopyMemo(): Promise<void> {
    if (!memo) {
      return;
    }

    await navigator.clipboard.writeText(memo);
    setCopyState("done");
    setTimeout(() => setCopyState("idle"), 1200);
  }

  async function onFeedback(rating: "up" | "down"): Promise<void> {
    setFeedbackState(rating);
    await fetch("/api/advisor/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        company_slug: companySlug,
        verdict,
        rating,
      }),
    }).catch(() => undefined);
  }

  const parsed = parseMemo(memo, verdict);
  const tone = verdictTone(verdict);

  return (
    <section className={`advisor-card ${tone}`}>
      <header className="advisor-header">
        <div>
          <h3>AI Due Diligence Advisor</h3>
          <p>Powered by GEMI Intelligence</p>
        </div>
        <span className={`advisor-verdict-pill ${tone}`}>{normalizeVerdictLabel(verdict)}</span>
      </header>

      {loading ? (
        <div className="advisor-loading">
          <p>Analyzing {metadata.evidencePoints || reportData.risk.evidence_flags.length} evidence points...</p>
          <div className="advisor-skeleton" />
          <div className="advisor-skeleton short" />
          <div className="advisor-skeleton" />
        </div>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <article className="advisor-memo">
          <p className="advisor-verdict-line">{parsed.verdictLine}</p>

          {parsed.keyConcerns.length > 0 ? (
            <>
              <h4>Key Concerns</h4>
              <ul className="advisor-list concerns">
                {parsed.keyConcerns.map((item, index) => (
                  <li key={`concern-${index}`}>
                    <span>⚠️</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {parsed.redeemingFactors.length > 0 ? (
            <>
              <h4>Redeeming Factors</h4>
              <ul className="advisor-list redeeming">
                {parsed.redeemingFactors.map((item, index) => (
                  <li key={`redeeming-${index}`}>
                    <span>✅</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h4>Final Recommendation</h4>
          <p className="advisor-final">{parsed.recommendation}</p>
        </article>
      )}

      <footer className="advisor-footer">
        <div className="advisor-meta-line">
          Based on {metadata.filingsParsed} filings · {metadata.pdfScanned} PDFs scanned ·{" "}
          {metadata.evidencePoints} evidence points · Data sourced from GEMI Registry · Generated{" "}
          {formatDate(metadata.generatedAt)}
          <span className="methodology-help" tabIndex={0} role="note" aria-label="Methodology">
            <Info size={13} />
            <span className="tooltip">
              Risk scoring is deterministic and evidence-based. AI synthesis interprets structured outputs and does not access external data.
            </span>
          </span>
        </div>

        <div className="advisor-actions">
          <button type="button" className="inline-action" onClick={onCopyMemo}>
            <Copy size={14} />
            {copyState === "done" ? "Copied" : "Copy Memo"}
          </button>

          <label className="advisor-toggle">
            <input
              type="checkbox"
              checked={includeInPdf}
              onChange={(event) => setIncludeInPdf(event.target.checked)}
            />
            <span>Include in PDF Export</span>
          </label>

          <button
            type="button"
            className={`inline-action ${feedbackState === "up" ? "active" : ""}`}
            onClick={() => onFeedback("up")}
            aria-label="Helpful memo"
          >
            <ThumbsUp size={14} />
          </button>
          <button
            type="button"
            className={`inline-action ${feedbackState === "down" ? "active" : ""}`}
            onClick={() => onFeedback("down")}
            aria-label="Unhelpful memo"
          >
            <ThumbsDown size={14} />
          </button>

          <span className="advisor-generated-by">
            {generatedBy === "ai" ? (
              <>
                <CheckCircle2 size={13} />
                AI synthesis
              </>
            ) : (
              "Deterministic synthesis"
            )}
          </span>
        </div>
      </footer>
    </section>
  );
}
