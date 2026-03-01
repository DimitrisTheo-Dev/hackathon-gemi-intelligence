"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Database,
  Download,
  FileText,
  FolderClock,
  Gauge,
  Info,
  Network,
  Newspaper,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AIAdvisor from "@/components/AIAdvisor";
import AnalystVerdict from "@/components/report/AnalystVerdict";
import RedFlagsCard from "@/components/report/RedFlagsCard";
import RiskScoreExplainer from "@/components/report/RiskScoreExplainer";
import { verdictFromScore as decisionFromScore, simulateRiskScore } from "@/lib/advisor";
import { readJsonSafe } from "@/lib/http-client";
import type { ReportDirector, ReportRecord, RiskEvidenceFlag, RiskScoreFactor } from "@/lib/types";

const FILINGS_COLLAPSED_COUNT = 5;
const DIRECTORS_COLLAPSED_COUNT = 8;
const FINANCIALS_COLLAPSED_COUNT = 8;
const RISK_EVIDENCE_COLLAPSED_COUNT = 5;

function riskTone(score: number): "low" | "medium" | "high" {
  if (score <= 3) return "low";
  if (score <= 6) return "medium";
  return "high";
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(date: string): string {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) {
    return date || "n/a";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function confidenceHelp(confidence: "low" | "medium" | "high"): string {
  if (confidence === "high") {
    return "High confidence: score is supported by multiple filings, directors, and financial records.";
  }

  if (confidence === "medium") {
    return "Medium confidence: score is based on partial evidence. Verify key filings before decisions.";
  }

  return "Low confidence: limited evidence available. Treat this as preliminary screening output.";
}

function parseDateValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const native = Date.parse(trimmed);
  if (!Number.isNaN(native)) {
    return native;
  }

  const match = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const yearRaw = Number.parseInt(match[3], 10);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const date = Date.UTC(year, month - 1, day);
  return Number.isNaN(date) ? null : date;
}

function isCurrentDirector(director: ReportDirector): boolean {
  const status = String(director.status || "").toLowerCase();
  if (status === "active") {
    return true;
  }

  const tenure = String(director.tenure || "").toLowerCase();
  if (/present|σήμερα|today/.test(tenure)) {
    return true;
  }

  const [, endRaw] = String(director.tenure || "").split("->");
  if (!endRaw) {
    return false;
  }

  const endTimestamp = parseDateValue(endRaw);
  if (!endTimestamp) {
    return false;
  }

  return endTimestamp >= Date.now();
}

function dedupeDirectors(directors: ReportDirector[]): ReportDirector[] {
  const seen = new Set<string>();
  const deduped: ReportDirector[] = [];

  for (const director of directors) {
    const key = `${director.name.toLowerCase()}|${director.role.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(director);
  }

  return deduped;
}

type AdvisorVerdict = "PROCEED" | "PROCEED_WITH_CONDITIONS" | "DO_NOT_PROCEED";

interface AdvisorExportPayload {
  includeInPdf: boolean;
  verdict: AdvisorVerdict;
  memo: string;
  generatedBy: "ai" | "deterministic";
  metadata: {
    evidencePoints: number;
    filingsParsed: number;
    pdfScanned: number;
    generatedAt: string;
  };
}

interface SearchCandidate {
  gemi_number: string;
}

interface ReportPayload {
  report: ReportRecord;
}

export default function ReportScreen({ mode, value }: { mode: "id" | "token"; value: string }) {
  const router = useRouter();

  const [record, setRecord] = useState<ReportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");
  const [exporting, setExporting] = useState(false);
  const [exportingMemo, setExportingMemo] = useState(false);
  const [showHistoricalDirectors, setShowHistoricalDirectors] = useState(false);
  const [selectedEvidenceFlagId, setSelectedEvidenceFlagId] = useState<string | null>(null);
  const [resolvedFlagIds, setResolvedFlagIds] = useState<string[]>([]);
  const [scoreDrawerOpen, setScoreDrawerOpen] = useState(false);
  const [advisorExport, setAdvisorExport] = useState<AdvisorExportPayload | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState("");
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [showAllFilings, setShowAllFilings] = useState(false);
  const [showAllDirectors, setShowAllDirectors] = useState(false);
  const [showAllFinancials, setShowAllFinancials] = useState(false);
  const [showAllRiskEvidence, setShowAllRiskEvidence] = useState(false);

  useEffect(() => {
    const endpoint = mode === "id" ? `/api/report/${value}` : `/api/report/share/${value}`;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await readJsonSafe<ReportPayload & { error?: string }>(response);

        if (!response.ok || !payload?.report) {
          throw new Error(payload?.error ?? "Unable to load report.");
        }

        setRecord(payload.report);
        setResolvedFlagIds([]);
        setShowAllFilings(false);
        setShowAllDirectors(false);
        setShowAllFinancials(false);
        setShowAllRiskEvidence(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unexpected error.");
      } finally {
        setLoading(false);
      }
    }

    load().catch(() => {
      setError("Unexpected error.");
      setLoading(false);
    });
  }, [mode, value]);

  useEffect(() => {
    if (!selectedEvidenceFlagId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSelectedEvidenceFlagId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedEvidenceFlagId]);

  const tone = useMemo(() => riskTone(record?.risk_score ?? 0), [record?.risk_score]);

  async function onCopyShareLink(): Promise<void> {
    if (!record) {
      return;
    }

    const shareUrl = `${window.location.origin}/report/share/${record.share_token}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopyState("done");
    setTimeout(() => setCopyState("idle"), 1300);
  }

  async function onExportPdf(): Promise<void> {
    if (!record || exporting) {
      return;
    }

    setExporting(true);

    try {
      const response = await fetch(`/api/report/${record.id}/pdf`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${record.company_name.replace(/\s+/g, "-").toLowerCase()}-due-diligence.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export PDF.");
    } finally {
      setExporting(false);
    }
  }

  async function onExportMemo(): Promise<void> {
    if (!record || exportingMemo) {
      return;
    }

    setExportingMemo(true);

    try {
      const response = await fetch(`/api/report/${record.id}/memo`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          resolved_flag_ids: resolvedFlagIds,
          scenario_label:
            resolvedFlagIds.length > 0
              ? `Simulation scenario: ${resolvedFlagIds.length} issue${
                  resolvedFlagIds.length > 1 ? "s" : ""
                } marked resolved`
              : "Base scenario",
          include_advisor: Boolean(advisorExport?.includeInPdf && advisorExport.memo),
          advisor_memo: advisorExport?.memo,
          advisor_verdict: advisorExport?.verdict,
          advisor_generated_by: advisorExport?.generatedBy,
          advisor_metadata: advisorExport?.metadata,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate IC memo");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${record.company_name.replace(/\s+/g, "-").toLowerCase()}-ic-memo.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export IC memo.");
    } finally {
      setExportingMemo(false);
    }
  }

  async function launchCompareSearch(query: string): Promise<string> {
    const initial = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const payload = await readJsonSafe<{
      search_id?: string;
      requires_selection?: boolean;
      candidates?: SearchCandidate[];
      error?: string;
    }>(initial);

    if (!initial.ok) {
      throw new Error(payload?.error || "Unable to launch comparison search.");
    }

    if (payload?.search_id) {
      return payload.search_id;
    }

    if (payload?.requires_selection && payload.candidates && payload.candidates.length > 0) {
      const retry = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          selected_gemi: payload.candidates[0].gemi_number,
        }),
      });
      const retryPayload = await readJsonSafe<{ search_id?: string; error?: string }>(retry);
      if (!retry.ok || !retryPayload?.search_id) {
        throw new Error(retryPayload?.error || "Unable to launch comparison search.");
      }
      return retryPayload.search_id;
    }

    throw new Error("Unable to launch comparison search.");
  }

  async function onCompareSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!record || comparing || !compareQuery.trim()) {
      return;
    }

    setComparing(true);
    setCompareError(null);

    try {
      const searchId = await launchCompareSearch(compareQuery.trim());
      router.push(`/search/${searchId}?compare_with=${record.id}`);
    } catch (cause) {
      setCompareError(cause instanceof Error ? cause.message : "Compare failed.");
      setComparing(false);
    }
  }

  function toggleFlagResolved(flagId: string): void {
    setResolvedFlagIds((current) =>
      current.includes(flagId)
        ? current.filter((item) => item !== flagId)
        : [...current, flagId],
    );
  }

  if (loading) {
    return (
      <main className="report-shell">
        <div className="report-grid" aria-hidden />
        <section className="report-loading">Loading intelligence report...</section>
      </main>
    );
  }

  if (!record || error) {
    return (
      <main className="report-shell">
        <div className="report-grid" aria-hidden />
        <section className="report-loading error">{error ?? "Report not found."}</section>
      </main>
    );
  }

  const report = record.report;
  const riskConfidence = report.risk.confidence || "low";
  const confidenceHint = report.risk.confidence_reason || confidenceHelp(riskConfidence);

  const evidenceFlags: RiskEvidenceFlag[] =
    report.risk.evidence_flags && report.risk.evidence_flags.length > 0
      ? report.risk.evidence_flags
      : (report.risk.flags || []).map((label, index) => ({
          id: `legacy-${index}`,
          label,
          severity: "info" as const,
          score_impact: 0,
          evidence: [],
        }));

  const scoreFactors: RiskScoreFactor[] =
    report.risk.score_factors && report.risk.score_factors.length > 0
      ? report.risk.score_factors
      : [
          {
            id: "baseline",
            label: "Baseline legal/compliance screening risk",
            impact: report.risk.base_score ?? 2,
          },
          ...evidenceFlags
            .filter((flag) => (flag.score_impact ?? 0) !== 0)
            .map((flag) => ({
              id: `factor-${flag.id}`,
              label: flag.label,
              impact: flag.score_impact ?? 0,
              source_flag_id: flag.id,
            })),
        ];

  const impactByFlag = new Map<string, number>();
  for (const factor of scoreFactors) {
    if (!factor.source_flag_id) {
      continue;
    }
    impactByFlag.set(
      factor.source_flag_id,
      (impactByFlag.get(factor.source_flag_id) ?? 0) + factor.impact,
    );
  }

  const simulatedScore = simulateRiskScore(report, resolvedFlagIds);
  const simulatedDecision = decisionFromScore(simulatedScore);

  const remediableFlags = evidenceFlags
    .map((flag) => ({
      ...flag,
      impact: impactByFlag.get(flag.id) ?? flag.score_impact ?? 0,
    }))
    .filter((flag) => flag.impact > 0)
    .sort((left, right) => right.impact - left.impact);

  const unresolvedRemediable = remediableFlags.filter(
    (flag) => !resolvedFlagIds.includes(flag.id),
  );
  const topTwoPotential = unresolvedRemediable.slice(0, 2);
  const projectedScore = simulateRiskScore(report, [
    ...resolvedFlagIds,
    ...topTwoPotential.map((flag) => flag.id),
  ]);
  const projectedDecision = decisionFromScore(projectedScore);
  const simulatedTone = riskTone(simulatedScore);

  const sourceQuality = report.source_quality || {
    filings_parsed: report.filings.length,
    financial_records: report.financials.length,
    pdfs_scanned: report.financials
      .filter((item) => Boolean(item.download_url) && Boolean(item.filename))
      .slice(0, 4).length,
    evidence_points: evidenceFlags.reduce((total, flag) => total + flag.evidence.length, 0),
    updated_at: report.generated_at,
  };

  const allDirectors = dedupeDirectors(report.directors);
  const currentDirectors = allDirectors.filter((director) => isCurrentDirector(director));
  const directorsToDisplay =
    showHistoricalDirectors || currentDirectors.length === 0 ? allDirectors : currentDirectors;
  const visibleRiskEvidenceFlags = showAllRiskEvidence
    ? evidenceFlags
    : evidenceFlags.slice(0, RISK_EVIDENCE_COLLAPSED_COUNT);
  const visibleFilings = showAllFilings
    ? report.filings
    : report.filings.slice(0, FILINGS_COLLAPSED_COUNT);
  const visibleDirectors = showAllDirectors
    ? directorsToDisplay
    : directorsToDisplay.slice(0, DIRECTORS_COLLAPSED_COUNT);
  const visibleFinancials = showAllFinancials
    ? report.financials
    : report.financials.slice(0, FINANCIALS_COLLAPSED_COUNT);
  const selectedEvidenceFlag =
    evidenceFlags.find((flag) => flag.id === selectedEvidenceFlagId) || null;

  return (
    <main className="report-shell">
      <div className="report-grid" aria-hidden />

      <div className="report-wrap">
        <AnalystVerdict
          score={simulatedScore}
          filingsCount={sourceQuality.filings_parsed}
          financialCount={sourceQuality.financial_records}
          evidenceCount={sourceQuality.evidence_points}
          flags={evidenceFlags.filter((flag) => !resolvedFlagIds.includes(flag.id))}
        />

        <RedFlagsCard flags={evidenceFlags.filter((flag) => !resolvedFlagIds.includes(flag.id))} />

        <section className={`decision-bar ${simulatedTone}`}>
          <div className="decision-copy">
            <p className="eyebrow">Analyst Decision</p>
            <h2>{simulatedDecision.replaceAll("_", " ")}</h2>
            <p>
              Current score {simulatedScore}/10. If top 2 open issues are resolved, projected decision shifts to{" "}
              <strong>{projectedDecision.replaceAll("_", " ")}</strong> ({simulatedScore} → {projectedScore}).
            </p>
          </div>
          <Gauge size={26} />
        </section>

        <motion.section
          className="overview-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="overview-head">
            <div>
              <p className="eyebrow">GEMI Intelligence Report</p>
              <h1>{report.company.name}</h1>
              <p className="subline">GEMI #{report.company.gemi_number}</p>
            </div>

            <div className="overview-actions">
              <Link href="/" className="report-primary-link" aria-label="Start a new company search">
                <Search size={14} />
                New search
              </Link>
              <button
                type="button"
                className={`inline-action compare-toggle-btn ${compareOpen ? "active" : ""}`}
                onClick={() => {
                  setCompareOpen((current) => !current);
                  setCompareError(null);
                }}
              >
                <SlidersHorizontal size={14} />
                Compare
              </button>
            </div>
          </div>

          <div className="meta-badges">
            <span className="badge">{report.company.legal_form}</span>
            <span className={`badge status ${report.company.status}`}>{report.company.status}</span>
          </div>

          {compareOpen ? (
            <form className="compare-form" onSubmit={onCompareSubmit}>
              <input
                value={compareQuery}
                onChange={(event) => setCompareQuery(event.target.value)}
                placeholder="Search a second company to compare"
                className="compare-input"
                autoComplete="off"
              />
              <button
                type="submit"
                className="inline-action compare-submit-btn"
                disabled={comparing || !compareQuery.trim()}
              >
                {comparing ? <RotateCcw size={14} className="spin" /> : <ArrowRight size={14} />}
                {comparing ? "Launching..." : "Run Compare"}
              </button>
              {compareError ? <p className="error-text">{compareError}</p> : null}
            </form>
          ) : null}

          <div className="top-metrics">
            <article>
              <label>Capital</label>
              <strong>{report.capital.raw_total || formatCurrency(report.capital.current_amount)}</strong>
            </article>
            <article>
              <label>Founded</label>
              <strong>{report.company.founded}</strong>
            </article>
            <article>
              <label>Activity</label>
              <strong>{report.company.activity_code || "n/a"}</strong>
            </article>
            <article>
              <label>Generated</label>
              <strong>{formatDate(report.generated_at)}</strong>
            </article>
          </div>

          <div className="source-quality-badge" role="note" aria-label="Source quality">
            <Database size={14} />
            <div>
              <strong>
                {sourceQuality.filings_parsed} filings parsed · {sourceQuality.pdfs_scanned} PDFs scanned
              </strong>
              <small>
                {sourceQuality.evidence_points} evidence points · Updated {formatDate(sourceQuality.updated_at)}
              </small>
            </div>
          </div>
        </motion.section>

        <motion.section
          className={`risk-hero ${tone}`}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
        >
          <div className="risk-head">
            <div>
              <p className="eyebrow">Risk Score</p>
              <div className="risk-score-row">
                <button type="button" className="risk-score-button" onClick={() => setScoreDrawerOpen(true)}>
                  <h2>
                    {simulatedScore} <span>/ 10</span>
                  </h2>
                </button>
                <button
                  type="button"
                  className="risk-help-btn"
                  onClick={() => setScoreDrawerOpen(true)}
                  aria-label="Open risk score breakdown"
                >
                  ?
                </button>
              </div>
              <div className="confidence-row">
                <p className={`confidence-chip ${riskConfidence}`}>Confidence: {riskConfidence}</p>
                <span className="confidence-help" tabIndex={0} role="note" aria-label={confidenceHint}>
                  <Info size={13} />
                  <span className="tooltip">{confidenceHint}</span>
                </span>
              </div>
            </div>
            <AlertTriangle size={26} />
          </div>

          <p className="risk-summary">{report.risk.summary}</p>
          <div className="flag-row">
            {evidenceFlags.map((flag, idx) => {
              const resolved = resolvedFlagIds.includes(flag.id);
              return (
                <button
                  key={`${flag.id}-${idx}`}
                  type="button"
                  className={`flag-chip ${flag.severity} ${selectedEvidenceFlagId === flag.id ? "active" : ""} ${resolved ? "resolved" : ""}`}
                  onClick={() => setSelectedEvidenceFlagId(flag.id)}
                >
                  {resolved ? "Resolved: " : ""}
                  {flag.label}
                </button>
              );
            })}
          </div>
          <ul className="risk-evidence-list">
            {visibleRiskEvidenceFlags.map((flag) => {
              const resolved = resolvedFlagIds.includes(flag.id);
              const impact = impactByFlag.get(flag.id) ?? flag.score_impact ?? 0;

              return (
                <li key={`evidence-${flag.id}`}>
                  <strong>{flag.label}</strong>
                  <p className="risk-evidence-preview">
                    {flag.evidence.length > 0
                      ? `${flag.evidence.length} evidence source${flag.evidence.length > 1 ? "s" : ""} linked.`
                      : "No direct source links were captured for this flag."}
                  </p>
                  <p className="risk-impact">Impact: {impact > 0 ? `+${impact}` : impact}</p>
                  <div className="risk-actions">
                    <button
                      type="button"
                      className="inline-action"
                      onClick={() => toggleFlagResolved(flag.id)}
                    >
                      {resolved ? "Mark unresolved" : "Mark resolved"}
                    </button>
                    <button
                      type="button"
                      className="inline-action"
                      onClick={() => setSelectedEvidenceFlagId(flag.id)}
                    >
                      Open evidence
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {evidenceFlags.length > RISK_EVIDENCE_COLLAPSED_COUNT ? (
            <button
              type="button"
              className="risk-more-btn"
              onClick={() => setShowAllRiskEvidence((current) => !current)}
            >
              {showAllRiskEvidence
                ? "Show fewer evidence items"
                : `Show ${evidenceFlags.length - visibleRiskEvidenceFlags.length} more evidence items`}
            </button>
          ) : null}
        </motion.section>

        <section className="report-panels">
          <div className="report-column report-column-main">
            <motion.article
              className="panel timeline"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.28 }}
            >
              <header>
                <FolderClock size={16} />
                <div className="panel-title">
                  <h3>Filings Timeline</h3>
                  <span className="panel-count">{report.filings.length}</span>
                </div>
              </header>
              <ul>
                {visibleFilings.map((filing, index) => (
                  <li
                    key={filing.id || `${filing.date}-${filing.type}-${index}`}
                    className={filing.gap_flag ? "gap" : ""}
                  >
                    <time>{formatDate(filing.date)}</time>
                    <div>
                      <strong>{filing.type}</strong>
                      <p>{filing.description}</p>
                      {filing.download_url ? (
                        <Link href={filing.download_url} target="_blank" rel="noreferrer">
                          View source filing
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {report.filings.length > FILINGS_COLLAPSED_COUNT ? (
                <button
                  type="button"
                  className="panel-more-btn"
                  onClick={() => setShowAllFilings((current) => !current)}
                >
                  {showAllFilings
                    ? "Show fewer filings"
                    : `Show ${report.filings.length - visibleFilings.length} more filings`}
                </button>
              ) : null}
            </motion.article>

            <motion.article
              className="panel ai-block"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              <header>
                <FileText size={16} />
                <h3>AI Narrative</h3>
              </header>
              <p>{report.ai_narrative}</p>
            </motion.article>

            <motion.article
              className="panel governance-panel"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.28 }}
            >
              <header>
                <Users size={16} />
                <h3>Active Governance Snapshot</h3>
              </header>
              <div className="governance-metrics">
                <article>
                  <label>Current seats</label>
                  <strong>{currentDirectors.length || allDirectors.length}</strong>
                </article>
                <article>
                  <label>Historical entries</label>
                  <strong>{Math.max(allDirectors.length - currentDirectors.length, 0)}</strong>
                </article>
              </div>
              {allDirectors.length === 0 ? (
                <p className="panel-empty">No governance members were parsed from the current registry view.</p>
              ) : (
                <ul className="snapshot-list">
                  {(currentDirectors.length > 0 ? currentDirectors : allDirectors)
                    .slice(0, 6)
                    .map((director, index) => (
                      <li key={`${director.name}-${director.role}-${index}`}>
                        <strong>{director.name}</strong>
                        <span>{director.role}</span>
                      </li>
                    ))}
                </ul>
              )}
            </motion.article>

            <motion.article
              className="panel"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.28 }}
            >
              <header>
                <Users size={16} />
                <div className="panel-title">
                  <h3>Directors</h3>
                  <span className="panel-count">{directorsToDisplay.length}</span>
                </div>
                <button
                  type="button"
                  className="inline-action"
                  onClick={() => setShowHistoricalDirectors((current) => !current)}
                >
                  {showHistoricalDirectors ? "Show current only" : "Show historical"}
                </button>
              </header>
              {directorsToDisplay.length === 0 ? (
                <p className="panel-empty">No directors were parsed from the current registry view.</p>
              ) : (
                <>
                  <ul className="director-list">
                    {visibleDirectors.map((director, index) => (
                      <li key={`${director.name}-${director.role}-${director.tenure}-${index}`}>
                        <details>
                          <summary>
                            <div>
                              <strong>{director.name}</strong>
                              <span>{director.role}</span>
                            </div>
                            <small>{director.tenure}</small>
                          </summary>
                          <div className="director-extra">
                            <p>
                              Appointed: {director.appointed} · Status: {director.status}
                            </p>
                            {director.flag ? <p className="director-flag">{director.flag}</p> : null}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                  {directorsToDisplay.length > DIRECTORS_COLLAPSED_COUNT ? (
                    <button
                      type="button"
                      className="panel-more-btn"
                      onClick={() => setShowAllDirectors((current) => !current)}
                    >
                      {showAllDirectors
                        ? "Show fewer directors"
                        : `Show ${directorsToDisplay.length - visibleDirectors.length} more directors`}
                    </button>
                  ) : null}
                </>
              )}
            </motion.article>
          </div>

          <div className="report-column report-column-side">
            <motion.article
              className="panel news-panel"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.28 }}
            >
              <header>
                <Newspaper size={16} />
                <div className="panel-title">
                  <h3>News</h3>
                  <span className="panel-count">{report.news.length}</span>
                </div>
              </header>
              {report.news.length === 0 ? (
                <p className="panel-empty">No news enrichment available. Add `SERPAPI_KEY` for live headlines.</p>
              ) : (
                <ul className="news-list">
                  {report.news.map((news) => (
                    <li key={`${news.headline}-${news.date}-${news.source}`}>
                      <strong>{news.headline}</strong>
                      <span>
                        {news.source} · {news.date} · {news.sentiment}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.article>

            <motion.article
              className="panel financial-panel"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.3 }}
            >
              <header>
                <ShieldCheck size={16} />
                <div className="panel-title">
                  <h3>Financial Statements</h3>
                  <span className="panel-count">{report.financials.length}</span>
                </div>
              </header>
              <ul className="financial-list">
                {visibleFinancials.map((row, index) => (
                  <li key={row.download_url || `${row.period}-${row.filename}-${index}`}>
                    <div>
                      <strong>{row.period}</strong>
                      <span>{row.auditor || "Auditor not disclosed"}</span>
                    </div>
                    {row.filename ? (
                      <Link href={row.download_url || "#"} target={row.download_url ? "_blank" : undefined}>
                        {row.filename}
                      </Link>
                    ) : (
                      <span>n/a</span>
                    )}
                  </li>
                ))}
              </ul>
              {report.financials.length > FINANCIALS_COLLAPSED_COUNT ? (
                <button
                  type="button"
                  className="panel-more-btn"
                  onClick={() => setShowAllFinancials((current) => !current)}
                >
                  {showAllFinancials
                    ? "Show fewer statements"
                    : `Show ${report.financials.length - visibleFinancials.length} more statements`}
                </button>
              ) : null}
            </motion.article>

            <motion.article
              className={`panel ownership ${report.shareholders.length === 0 ? "panel-compact" : ""}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.28 }}
            >
              <header>
                <Network size={16} />
                <div className="panel-title">
                  <h3>Ownership Tree</h3>
                  <span className="panel-count">{report.shareholders.length}</span>
                </div>
              </header>
              {report.shareholders.length === 0 ? (
                <p className="panel-empty">No shareholder entities were exposed in the scraped public section.</p>
              ) : (
                <ul className="ownership-list">
                  {report.shareholders.map((holder, index) => (
                    <li key={`${holder.name}-${holder.entity_type}-${holder.percentage}-${index}`}>
                      <div>
                        <strong>{holder.name}</strong>
                        <span>{holder.entity_type}</span>
                      </div>
                      <b>{holder.percentage}%</b>
                    </li>
                  ))}
                </ul>
              )}
            </motion.article>
          </div>
        </section>

        <AIAdvisor
          companySlug={report.company.gemi_number || record.id}
          reportData={report}
          resolvedFlagIds={resolvedFlagIds}
          onMemoChange={setAdvisorExport}
        />

        <motion.footer
          className="export-bar"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.32 }}
        >
          <div className="export-primary-actions">
            <button className="export-btn" onClick={onExportMemo} disabled={mode !== "id" || exportingMemo}>
              <Download size={16} />
              {exportingMemo ? "Generating IC memo..." : "Export IC Memo"}
            </button>
            <button className="export-btn" onClick={onExportPdf} disabled={mode !== "id" || exporting}>
              <Download size={16} />
              {exporting ? "Generating full PDF..." : "Export Full PDF"}
            </button>
          </div>
          <button className="export-btn export-copy-btn" onClick={onCopyShareLink}>
            <Copy size={16} />
            {copyState === "done" ? "Link copied" : "Copy share link"}
          </button>
        </motion.footer>
      </div>

      <RiskScoreExplainer
        open={scoreDrawerOpen}
        onClose={() => setScoreDrawerOpen(false)}
        score={simulatedScore}
        confidence={riskConfidence}
        confidenceHint={confidenceHint}
        factors={scoreFactors}
        evidencePoints={sourceQuality.evidence_points}
        filingsParsed={sourceQuality.filings_parsed}
        pdfsScanned={sourceQuality.pdfs_scanned}
      />

      {selectedEvidenceFlag ? (
        <div
          className="evidence-overlay"
          onClick={() => setSelectedEvidenceFlagId(null)}
          role="presentation"
        >
          <aside
            className="evidence-drawer"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Evidence details"
          >
            <header>
              <div>
                <p className="eyebrow">Evidence Drawer</p>
                <h3>{selectedEvidenceFlag.label}</h3>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedEvidenceFlagId(null)}
                aria-label="Close evidence drawer"
              >
                <X size={16} />
              </button>
            </header>

            {selectedEvidenceFlag.evidence.length === 0 ? (
              <p className="panel-empty">No source rows are attached to this flag.</p>
            ) : (
              <ul className="evidence-source-list">
                {selectedEvidenceFlag.evidence.map((source, index) => (
                  <li key={`${selectedEvidenceFlag.id}-${index}`}>
                    <div className="evidence-source-head">
                      {source.url ? (
                        <Link href={source.url} target="_blank" rel="noreferrer">
                          {source.label}
                        </Link>
                      ) : (
                        <strong>{source.label}</strong>
                      )}
                    </div>
                    <p>
                      {source.date ? <span>{formatDate(source.date)}</span> : null}
                      {source.reference ? <span> · {source.reference}</span> : null}
                    </p>
                    {source.snippet ? <blockquote>{source.snippet}</blockquote> : null}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
