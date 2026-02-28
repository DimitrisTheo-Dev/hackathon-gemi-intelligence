"use client";

import { AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";

import type { RiskEvidenceFlag } from "@/lib/types";

interface AnalystVerdictProps {
  score: number;
  filingsCount: number;
  financialCount: number;
  evidenceCount: number;
  flags: RiskEvidenceFlag[];
}

function topFlagSummary(flags: RiskEvidenceFlag[]): string {
  const high = flags.filter((flag) => flag.severity === "critical").slice(0, 2);
  const fallback = flags.filter((flag) => (flag.score_impact || 0) > 0).slice(0, 2);
  const selected = high.length > 0 ? high : fallback;
  if (selected.length === 0) {
    return "No dominant red-flag cluster was detected in the current evidence set";
  }

  if (selected.length === 1) {
    return selected[0].label;
  }

  return `${selected[0].label} and ${selected[1].label}`;
}

export default function AnalystVerdict({
  score,
  filingsCount,
  financialCount,
  evidenceCount,
  flags,
}: AnalystVerdictProps) {
  const summary = topFlagSummary(flags);

  const verdict =
    score <= 3
      ? `Low Risk - No material concerns detected across ${filingsCount} filings and ${financialCount} financial records.`
      : score <= 5
        ? `Moderate Risk - ${summary}. Further review recommended.`
        : score <= 7
          ? `Elevated Risk - ${summary} detected across ${evidenceCount} evidence points.`
          : "High Risk - Significant compliance and financial concerns identified. Exercise caution.";

  const tone = score <= 3 ? "low" : score <= 5 ? "medium" : score <= 7 ? "elevated" : "high";

  return (
    <section className={`analyst-verdict-banner ${tone}`}>
      <div className="analyst-verdict-icon">
        {tone === "low" ? <ShieldCheck size={16} /> : tone === "high" ? <ShieldAlert size={16} /> : <AlertTriangle size={16} />}
      </div>
      <p>{verdict}</p>
    </section>
  );
}
