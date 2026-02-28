"use client";

import { ArrowLeftRight, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ReportRecord } from "@/lib/types";

interface ReportPayload {
  report: ReportRecord;
}

function parseYear(value: string): number | null {
  const match = value.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function verdictFromScore(score: number): string {
  if (score <= 3) return "PROCEED";
  if (score <= 7) return "PROCEED WITH CONDITIONS";
  return "DO NOT PROCEED";
}

async function fetchBySlug(slug: string): Promise<ReportRecord> {
  const direct = await fetch(`/api/report/${slug}`, { cache: "no-store" });
  if (direct.ok) {
    const payload = (await direct.json()) as ReportPayload;
    if (payload.report) {
      return payload.report;
    }
  }

  const shared = await fetch(`/api/report/share/${slug}`, { cache: "no-store" });
  const sharedPayload = (await shared.json()) as ReportPayload & { error?: string };
  if (!shared.ok || !sharedPayload.report) {
    throw new Error(sharedPayload.error || "Unable to load comparison report.");
  }

  return sharedPayload.report;
}

export default function CompareScreen({ slugA, slugB }: { slugA: string; slugB: string }) {
  const [left, setLeft] = useState<ReportRecord | null>(null);
  const [right, setRight] = useState<ReportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        setLoading(true);
        const [a, b] = await Promise.all([fetchBySlug(slugA), fetchBySlug(slugB)]);
        setLeft(a);
        setRight(b);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load comparison.");
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => {
      setError("Unable to load comparison.");
      setLoading(false);
    });
  }, [slugA, slugB]);

  const rows = useMemo(() => {
    if (!left || !right) {
      return [];
    }

    const nowYear = new Date().getUTCFullYear();
    const leftFounded = parseYear(left.report.company.founded);
    const rightFounded = parseYear(right.report.company.founded);
    const leftYears = leftFounded ? nowYear - leftFounded : 0;
    const rightYears = rightFounded ? nowYear - rightFounded : 0;
    const leftPdf = left.report.source_quality?.pdfs_scanned ?? 0;
    const rightPdf = right.report.source_quality?.pdfs_scanned ?? 0;
    const leftRedFlags = (left.report.risk.evidence_flags || []).filter(
      (flag) => flag.severity === "critical",
    ).length;
    const rightRedFlags = (right.report.risk.evidence_flags || []).filter(
      (flag) => flag.severity === "critical",
    ).length;

    return [
      {
        label: "Risk Score",
        left: left.report.risk.score,
        right: right.report.risk.score,
        better: "lower",
      },
      {
        label: "Capital (EUR)",
        left: Math.round(left.report.capital.current_amount),
        right: Math.round(right.report.capital.current_amount),
        better: "higher",
      },
      {
        label: "Director Count",
        left: left.report.directors.length,
        right: right.report.directors.length,
        better: "lower",
      },
      {
        label: "Years Active",
        left: leftYears,
        right: rightYears,
        better: "higher",
      },
      {
        label: "Filings Count",
        left: left.report.filings.length,
        right: right.report.filings.length,
        better: "higher",
      },
      {
        label: "PDFs Scanned",
        left: leftPdf,
        right: rightPdf,
        better: "higher",
      },
      {
        label: "Critical Flags",
        left: leftRedFlags,
        right: rightRedFlags,
        better: "lower",
      },
      {
        label: "Analyst Verdict",
        left: verdictFromScore(left.report.risk.score),
        right: verdictFromScore(right.report.risk.score),
        better: "lower",
        compareByScore: true,
      },
    ] as Array<{
      label: string;
      left: number | string;
      right: number | string;
      better: "lower" | "higher";
      compareByScore?: boolean;
    }>;
  }, [left, right]);

  async function onExport(): Promise<void> {
    if (exporting) {
      return;
    }

    setExporting(true);
    try {
      const response = await fetch(`/api/compare/${slugA}/${slugB}/pdf`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "gemi-comparison.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export comparison PDF.");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <main className="report-shell">
        <div className="report-grid" aria-hidden />
        <section className="report-loading">Loading comparison...</section>
      </main>
    );
  }

  if (error || !left || !right) {
    return (
      <main className="report-shell">
        <div className="report-grid" aria-hidden />
        <section className="report-loading error">{error || "Comparison unavailable."}</section>
      </main>
    );
  }

  return (
    <main className="report-shell">
      <div className="report-grid" aria-hidden />
      <div className="report-wrap">
        <section className="overview-card compare-header">
          <p className="eyebrow">Comparison Mode</p>
          <h1>
            {left.report.company.name} <ArrowLeftRight size={20} /> {right.report.company.name}
          </h1>
          <p className="subline">
            <Link href={`/report/${left.id}`}>Open left report</Link> ·{" "}
            <Link href={`/report/${right.id}`}>Open right report</Link>
          </p>
        </section>

        <section className="compare-table-card">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>{left.report.company.name}</th>
                <th>{right.report.company.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const leftNumeric = Number(row.left);
                const rightNumeric = Number(row.right);
                const comparable = Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric);
                const leftBetter = comparable
                  ? row.better === "lower"
                    ? leftNumeric < rightNumeric
                    : leftNumeric > rightNumeric
                  : false;
                const rightBetter = comparable
                  ? row.better === "lower"
                    ? rightNumeric < leftNumeric
                    : rightNumeric > leftNumeric
                  : false;

                return (
                  <tr key={`${row.label}-${index}`}>
                    <td>{row.label}</td>
                    <td className={leftBetter ? "better-cell" : ""}>{String(row.left)}</td>
                    <td className={rightBetter ? "better-cell" : ""}>{String(row.right)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <footer className="export-bar">
          <button onClick={onExport} disabled={exporting}>
            <Download size={16} />
            {exporting ? "Generating comparison PDF..." : "Export Comparison PDF"}
          </button>
        </footer>
      </div>
    </main>
  );
}
