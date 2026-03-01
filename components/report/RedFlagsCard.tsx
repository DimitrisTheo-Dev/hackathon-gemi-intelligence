"use client";

import { AlertTriangle, CheckCircle2, FileWarning, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { RiskEvidenceFlag } from "@/lib/types";

interface RedFlagsCardProps {
  flags: RiskEvidenceFlag[];
}

function iconForFlag(flag: RiskEvidenceFlag) {
  const source = `${flag.id} ${flag.label}`.toLowerCase();
  if (source.includes("unsigned") || source.includes("signature")) {
    return <FileWarning size={15} />;
  }
  if (source.includes("auditor") || source.includes("qualified")) {
    return <ShieldAlert size={15} />;
  }
  return <AlertTriangle size={15} />;
}

export default function RedFlagsCard({ flags }: RedFlagsCardProps) {
  const critical = flags
    .filter((flag) => {
      const impact = flag.score_impact ?? 0;
      return impact >= 0 && (flag.severity === "critical" || impact > 0.6);
    })
    .slice(0, 6);

  return (
    <section className="red-flags-card">
      <header>
        <h3>Red Flags</h3>
      </header>

      {critical.length === 0 ? (
        <div className="red-flags-empty">
          <CheckCircle2 size={16} />
          <span>No critical flags detected.</span>
        </div>
      ) : (
        <ul className="red-flags-list">
          {critical.map((flag, index) => {
            const source = flag.evidence.find((item) => item.url);
            return (
              <li key={`${flag.id}-${index}`}>
                <div className="red-flag-main">
                  {iconForFlag(flag)}
                  <strong>{flag.label}</strong>
                </div>
                {source?.url ? (
                  <Link href={source.url} target="_blank" rel="noreferrer">
                    Source
                  </Link>
                ) : (
                  <span className="red-flag-source-muted">Source not linked</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
