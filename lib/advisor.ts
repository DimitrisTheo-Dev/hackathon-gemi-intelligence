import type { GEMIReport, RiskEvidenceFlag, RiskScoreFactor } from "@/lib/types";
import { clamp, parseYear } from "@/lib/utils";

export type AdvisorVerdict = "PROCEED" | "PROCEED_WITH_CONDITIONS" | "DO_NOT_PROCEED";

export interface AdvisorMetadata {
  evidencePoints: number;
  filingsParsed: number;
  pdfScanned: number;
  generatedAt: string;
}

export interface AdvisorScenario {
  score: number;
  verdict: AdvisorVerdict;
  confidence: "low" | "medium" | "high";
  topHighFlags: RiskEvidenceFlag[];
  topModerateFlags: RiskEvidenceFlag[];
  evidencePoints: number;
  filingsParsed: number;
  pdfScanned: number;
  financialRecords: number;
  yearsActive: number | null;
  lastFilingDate: string;
  filingStatus: string;
  directorCount: number;
  recentDirectorChanges: number;
  capitalAmount: number;
  industry: string;
  auditSignal: string;
}

export function verdictFromScore(score: number): AdvisorVerdict {
  if (score <= 3) return "PROCEED";
  if (score <= 7) return "PROCEED_WITH_CONDITIONS";
  return "DO_NOT_PROCEED";
}

function normalizeScoreFactors(report: GEMIReport): RiskScoreFactor[] {
  if (Array.isArray(report.risk.score_factors) && report.risk.score_factors.length > 0) {
    return report.risk.score_factors;
  }

  const baseRaw = report.risk.base_score;
  const base = typeof baseRaw === "number" && Number.isFinite(baseRaw) ? baseRaw : 2;
  const fromFlags = (report.risk.evidence_flags || [])
    .filter((flag) => Number.isFinite(flag.score_impact) && (flag.score_impact || 0) !== 0)
    .map((flag) => ({
      id: `factor-${flag.id}`,
      label: flag.label,
      impact: flag.score_impact || 0,
      source_flag_id: flag.id,
    }));

  return [
    {
      id: "baseline",
      label: "Baseline legal/compliance screening risk",
      impact: base,
    },
    ...fromFlags,
  ];
}

function normalizeResolvedFlagIds(resolvedFlagIds: string[]): Set<string> {
  return new Set(
    resolvedFlagIds
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0),
  );
}

export function simulateRiskScore(report: GEMIReport, resolvedFlagIds: string[]): number {
  const factors = normalizeScoreFactors(report);
  const resolvedSet = normalizeResolvedFlagIds(resolvedFlagIds);
  const raw = factors.reduce((sum, factor) => {
    if (factor.source_flag_id && resolvedSet.has(factor.source_flag_id)) {
      return sum;
    }
    return sum + factor.impact;
  }, 0);

  return clamp(Math.round(raw), 0, 10);
}

function countRecentDirectorChanges(report: GEMIReport): number {
  const currentYear = new Date().getUTCFullYear();
  const threshold = currentYear - 2;
  let count = 0;

  for (const director of report.directors) {
    const fromYear = parseYear(director.appointed);
    if (fromYear && fromYear >= threshold) {
      count += 1;
      continue;
    }

    const tenureYear = parseYear(director.tenure);
    if (tenureYear && tenureYear >= threshold) {
      count += 1;
    }
  }

  return count;
}

function inferAuditSignal(report: GEMIReport): string {
  const labels = (report.risk.evidence_flags || [])
    .map((flag) => `${flag.id} ${flag.label}`.toLowerCase());

  if (labels.some((item) => item.includes("pdf-qualified-opinion"))) {
    return "qualified/adverse opinion keywords detected";
  }

  if (labels.some((item) => item.includes("unsigned"))) {
    return "unsigned signature indicators detected";
  }

  if (labels.some((item) => item.includes("auditor-switch"))) {
    return "auditor switch detected";
  }

  if (labels.some((item) => item.includes("annual-filing-regular"))) {
    return "no adverse audit signals from sampled records";
  }

  return "no explicit audit signal";
}

function sourceQuality(report: GEMIReport): {
  filingsParsed: number;
  financialRecords: number;
  pdfScanned: number;
  evidencePoints: number;
} {
  const filingsParsed = report.source_quality?.filings_parsed ?? report.filings.length;
  const financialRecords = report.source_quality?.financial_records ?? report.financials.length;
  const pdfScanned =
    report.source_quality?.pdfs_scanned ??
    report.financials
      .filter((item) => Boolean(item.download_url) && Boolean(item.filename))
      .slice(0, 4).length;
  const evidencePoints =
    report.source_quality?.evidence_points ??
    (report.risk.evidence_flags || []).reduce((sum, flag) => sum + flag.evidence.length, 0);

  return {
    filingsParsed,
    financialRecords,
    pdfScanned,
    evidencePoints,
  };
}

export function buildAdvisorScenario(
  report: GEMIReport,
  resolvedFlagIds: string[],
): AdvisorScenario {
  const score = simulateRiskScore(report, resolvedFlagIds);
  const verdict = verdictFromScore(score);
  const quality = sourceQuality(report);
  const resolvedSet = normalizeResolvedFlagIds(resolvedFlagIds);

  const highFlags = (report.risk.evidence_flags || [])
    .filter(
      (flag) =>
        !resolvedSet.has(flag.id) &&
        (flag.severity === "critical" || (flag.score_impact || 0) >= 2),
    )
    .slice(0, 3);

  const moderateFlags = (report.risk.evidence_flags || [])
    .filter(
      (flag) =>
        !resolvedSet.has(flag.id) &&
        flag.severity !== "critical" &&
        (flag.score_impact || 0) > 0,
    )
    .slice(0, 4);

  const newestFiling = report.filings[0];
  const foundedYear = parseYear(report.company.founded);
  const yearsActive = foundedYear ? new Date().getUTCFullYear() - foundedYear : null;

  return {
    score,
    verdict,
    confidence: report.risk.confidence,
    topHighFlags: highFlags,
    topModerateFlags: moderateFlags,
    evidencePoints: quality.evidencePoints,
    filingsParsed: quality.filingsParsed,
    pdfScanned: quality.pdfScanned,
    financialRecords: quality.financialRecords,
    yearsActive,
    lastFilingDate: newestFiling?.date || "n/a",
    filingStatus: newestFiling ? "up to date" : "limited filing history",
    directorCount: report.directors.length,
    recentDirectorChanges: countRecentDirectorChanges(report),
    capitalAmount: report.capital.current_amount || 0,
    industry:
      report.company.activity_description ||
      report.company.activity_code ||
      "industry not explicitly disclosed",
    auditSignal: inferAuditSignal(report),
  };
}

export function buildAdvisorUserPrompt(
  report: GEMIReport,
  resolvedFlagIds: string[],
): string {
  const scenario = buildAdvisorScenario(report, resolvedFlagIds);

  const highFlags =
    scenario.topHighFlags.length > 0
      ? scenario.topHighFlags.map((flag) => `- ${flag.label}`).join("\n")
      : "- none detected";

  const moderateFlags =
    scenario.topModerateFlags.length > 0
      ? scenario.topModerateFlags.map((flag) => `- ${flag.label}`).join("\n")
      : "- none detected";

  return `Company: ${report.company.name}
Industry: ${scenario.industry}
Risk Score: ${scenario.score}/10
Confidence: ${scenario.confidence}
Years Active: ${scenario.yearsActive ?? "n/a"}
Filing Status: ${scenario.filingStatus} — last filed ${scenario.lastFilingDate}
Capital: ${Math.round(scenario.capitalAmount)} EUR
Directors: ${scenario.directorCount} current, ${scenario.recentDirectorChanges} changes in last 2 years
Evidence Points Analyzed: ${scenario.evidencePoints}
High-Severity Flags:
${highFlags}
Moderate Flags:
${moderateFlags}
Audit Signal: ${scenario.auditSignal} (from financial PDF parsing)
Financial Records Available: ${scenario.financialRecords}

Deliver your advisory memo now.`;
}

function topFlagLabel(flags: RiskEvidenceFlag[], fallback: string): string {
  return flags[0]?.label || fallback;
}

export function buildDeterministicAdvisorMemo(
  report: GEMIReport,
  resolvedFlagIds: string[],
): { verdict: AdvisorVerdict; memo: string; metadata: AdvisorMetadata } {
  const scenario = buildAdvisorScenario(report, resolvedFlagIds);
  const topFlag1 = topFlagLabel(
    [...scenario.topHighFlags, ...scenario.topModerateFlags],
    "no material flags in sampled records",
  );
  const topFlag2 = topFlagLabel(
    [...scenario.topHighFlags.slice(1), ...scenario.topModerateFlags.slice(1)],
    "limited secondary concerns",
  );
  const lastFilingDate = scenario.lastFilingDate || "n/a";

  let memo = "";

  if (scenario.score <= 3) {
    memo = `Verdict: PROCEED
Key Concerns:
- No material concerns were detected in the current evidence sample.
- Governance and filing cadence appear consistent with normal compliance practice.
Redeeming Factors:
- I reviewed ${scenario.filingsParsed} filings, ${scenario.financialRecords} financial records, and ${scenario.pdfScanned} sampled PDFs with no high-severity warning pattern.
- Filing status is ${scenario.filingStatus}, with latest filing dated ${lastFilingDate}.
Final Recommendation:
I recommend proceeding with standard contractual protections and ordinary confirmatory diligence.`;
  } else if (scenario.score <= 5) {
    memo = `Verdict: PROCEED WITH CONDITIONS
Key Concerns:
- ${topFlag1}
- ${topFlag2}
Redeeming Factors:
- The current record still shows usable compliance evidence across ${scenario.filingsParsed} filings.
Final Recommendation:
I recommend proceeding only after documented clarification of the flagged issues and confirmation that no additional filing-quality issues are outstanding.`;
  } else if (scenario.score <= 7) {
    memo = `Verdict: PROCEED WITH CONDITIONS
Key Concerns:
- ${topFlag1}
- ${topFlag2}
- The aggregate risk profile remains elevated at ${scenario.score}/10 and impacts counterparty reliability.
Redeeming Factors:
- There is still enough structured evidence (${scenario.evidencePoints} evidence points) to run targeted remediation checks.
Final Recommendation:
I would not proceed without independent legal validation of the filing history and a written management explanation covering the top flagged concerns.`;
  } else {
    memo = `Verdict: DO NOT PROCEED
Key Concerns:
- ${topFlag1}
- ${topFlag2}
- The combined signal from ${scenario.evidencePoints} evidence points indicates serious compliance and financial reliability concerns.
Redeeming Factors:
- Limited redeeming factors are visible in the current public record.
Final Recommendation:
I do not recommend proceeding under current conditions. Re-open only if the critical issues are formally resolved and re-verified against updated filings.`;
  }

  return {
    verdict: scenario.verdict,
    memo,
    metadata: {
      evidencePoints: scenario.evidencePoints,
      filingsParsed: scenario.filingsParsed,
      pdfScanned: scenario.pdfScanned,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function parseVerdictFromMemo(memo: string): AdvisorVerdict | null {
  const normalized = memo.toUpperCase();
  if (normalized.includes("DO NOT PROCEED")) return "DO_NOT_PROCEED";
  if (normalized.includes("PROCEED WITH CONDITIONS")) return "PROCEED_WITH_CONDITIONS";
  if (normalized.includes("PROCEED")) return "PROCEED";
  return null;
}
