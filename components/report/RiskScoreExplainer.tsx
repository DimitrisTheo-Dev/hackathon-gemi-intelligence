"use client";

import { X } from "lucide-react";

import type { RiskScoreFactor } from "@/lib/types";

interface RiskScoreExplainerProps {
  open: boolean;
  onClose: () => void;
  score: number;
  confidence: "low" | "medium" | "high";
  confidenceHint: string;
  factors: RiskScoreFactor[];
  evidencePoints: number;
  filingsParsed: number;
  pdfsScanned: number;
}

function prettyFactorLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function RiskScoreExplainer({
  open,
  onClose,
  score,
  confidence,
  confidenceHint,
  factors,
  evidencePoints,
  filingsParsed,
  pdfsScanned,
}: RiskScoreExplainerProps) {
  if (!open) {
    return null;
  }

  const maxAbs = Math.max(...factors.map((factor) => Math.abs(factor.impact)), 1);

  return (
    <div className="risk-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="risk-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Risk score breakdown"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Risk Score Breakdown</p>
            <h3>
              {score} / 10
            </h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close risk breakdown">
            <X size={16} />
          </button>
        </header>

        <p className={`risk-drawer-confidence ${confidence}`}>
          Confidence: {confidence}
        </p>
        <p className="risk-drawer-sub">{confidenceHint}</p>

        <ul className="risk-factor-bars">
          {factors.map((factor, index) => {
            const width = `${(Math.abs(factor.impact) / maxAbs) * 100}%`;
            const tone = factor.impact >= 2 ? "high" : factor.impact > 0 ? "medium" : "positive";

            return (
              <li key={`${factor.id}-${index}`}>
                <div className="risk-factor-line">
                  <span>{prettyFactorLabel(factor.label)}</span>
                  <b>{factor.impact > 0 ? `+${factor.impact}` : factor.impact}</b>
                </div>
                <div className="risk-factor-track">
                  <div className={`risk-factor-fill ${tone}`} style={{ width }} />
                </div>
              </li>
            );
          })}
        </ul>

        <p className="risk-drawer-meta">
          Evidence Points: {evidencePoints} | Based on {filingsParsed} filings and {pdfsScanned} scanned PDFs | Sources: GEMI Registry, Financial Filings
        </p>
      </aside>
    </div>
  );
}
