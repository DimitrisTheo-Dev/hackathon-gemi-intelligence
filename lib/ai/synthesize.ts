import OpenAI from "openai";

import { hasUserAiKey, type UserApiKeys } from "@/lib/api-keys";
import { hasAuditorSwitch, latestBoardChanges, normalizeFilingsWithGaps } from "@/lib/analysis";
import { env } from "@/lib/env";
import type {
  GEMIRawData,
  GEMIReport,
  ReportFiling,
  RiskEvidenceFlag,
  RiskScoreFactor,
} from "@/lib/types";
import { clamp, mapCompanyStatus, parseYear, toNumber } from "@/lib/utils";

const AI_SYSTEM_PROMPT =
  "You are a senior Greek due diligence counsel. Return strict JSON with keys: risk.summary, risk.score, risk.flags (string[]), ai_narrative. Keep content specific and concise.";

function buildHeuristicReport(raw: GEMIRawData): GEMIReport {
  const filings = normalizeFilingsWithGaps(raw.filings);
  const evidenceFlags: RiskEvidenceFlag[] = [];
  const baseScore = 2;
  let score = baseScore;
  const scoreFactors: RiskScoreFactor[] = [
    {
      id: "baseline",
      label: "Baseline legal/compliance screening risk",
      impact: baseScore,
    },
  ];
  let confidencePoints = 0;

  if (raw.source === "live") {
    confidencePoints += 2;
  }
  if (raw.financials.length >= 2) {
    confidencePoints += 1;
  }
  if (filings.length >= 6) {
    confidencePoints += 1;
  }
  if (raw.directors.length >= 2) {
    confidencePoints += 1;
  }
  if (raw.flags.pdf_signals.length > 0) {
    confidencePoints += 1;
  }

  function addEvidenceFlag(
    flag: Omit<RiskEvidenceFlag, "id"> & { id?: string },
    scoreDelta = 0,
  ): void {
    const resolvedId = flag.id || `${flag.severity}-${evidenceFlags.length + 1}`;

    evidenceFlags.push({
      id: resolvedId,
      label: flag.label,
      severity: flag.severity,
      score_impact: scoreDelta,
      evidence: flag.evidence,
    });

    if (scoreDelta !== 0) {
      scoreFactors.push({
        id: `factor-${resolvedId}`,
        label: flag.label,
        impact: scoreDelta,
        source_flag_id: resolvedId,
      });
    }

    score += scoreDelta;
  }

  function boardRelatedFiling(filing: ReportFiling): boolean {
    const source = `${filing.type} ${filing.description}`.toLowerCase();
    return /(board|director|διοικητ|δ\.σ\.|διοικ|ανασυγκροτ|εκλογη ελεγκ)/.test(source);
  }

  if (raw.flags.unsigned_financials.length > 0) {
    addEvidenceFlag(
      {
        id: "unsigned-financial-file",
        label: `Unsigned annual financial statement detected (${raw.flags.unsigned_financials[0]?.filename}).`,
        severity: "critical",
        evidence: raw.flags.unsigned_financials.slice(0, 3).map((item) => ({
          label: item.filename,
          snippet: "Filename contains unsigned/ανυπόγραφ keyword.",
          url: item.href,
        })),
      },
      2,
    );
  }

  const pdfUnsigned = raw.flags.pdf_signals.filter((signal) => signal.unsigned);
  if (pdfUnsigned.length > 0) {
    addEvidenceFlag(
      {
        id: "pdf-unsigned-signal",
        label: "Financial PDF contains unsigned or missing-signature keywords.",
        severity: "critical",
        evidence: pdfUnsigned.slice(0, 3).map((signal) => ({
          label: `${signal.period} · ${signal.filename}`,
          reference: "PDF keyword scan",
          snippet: signal.excerpt,
          url: signal.download_url,
        })),
      },
      1,
    );
  }

  const pdfQualified = raw.flags.pdf_signals.filter((signal) => signal.qualified_opinion);
  if (pdfQualified.length > 0) {
    addEvidenceFlag(
      {
        id: "pdf-qualified-opinion",
        label: "Qualified/adverse/disclaimer opinion keywords detected in financial statement PDFs.",
        severity: "critical",
        evidence: pdfQualified.slice(0, 3).map((signal) => ({
          label: `${signal.period} · ${signal.filename}`,
          reference: "Qualified/adverse/disclaimer keyword match",
          snippet: signal.excerpt,
          url: signal.download_url,
        })),
      },
      2,
    );
  }

  const missingSignatureHints = raw.flags.pdf_signals.filter(
    (signal) => !signal.signature_marker && signal.auditor_opinion,
  );
  if (missingSignatureHints.length > 0) {
    addEvidenceFlag(
      {
        id: "pdf-signature-missing",
        label: "Auditor-opinion text found but signature markers were not detected in sampled PDFs.",
        severity: "warning",
        evidence: missingSignatureHints.slice(0, 3).map((signal) => ({
          label: `${signal.period} · ${signal.filename}`,
          snippet: signal.excerpt,
          url: signal.download_url,
        })),
      },
      1,
    );
  }

  const auditor = hasAuditorSwitch(raw.financials);
  if (auditor.switched) {
    const sortedFinancials = [...raw.financials].sort((left, right) => {
      const yearLeft = parseYear(left.period) ?? 0;
      const yearRight = parseYear(right.period) ?? 0;
      return yearLeft - yearRight;
    });

    const fromEntry = sortedFinancials.find((item) => item.auditor === auditor.from);
    const toEntry = [...sortedFinancials].reverse().find((item) => item.auditor === auditor.to);

    addEvidenceFlag(
      {
        id: "auditor-switch",
        label: `Auditor switch detected: ${auditor.from} -> ${auditor.to}.`,
        severity: "warning",
        evidence: [
          {
            label: `${fromEntry?.period || "Earlier period"} · ${auditor.from}`,
            url: fromEntry?.download_url,
            reference: fromEntry?.filename,
          },
          {
            label: `${toEntry?.period || "Latest period"} · ${auditor.to}`,
            url: toEntry?.download_url,
            reference: toEntry?.filename,
          },
        ].filter((entry) => entry.label),
      },
      1,
    );
  }

  const boardChanges = latestBoardChanges(filings);
  if (boardChanges.year && boardChanges.count >= 2) {
    const boardFilings = filings
      .filter((filing) => parseYear(filing.date) === boardChanges.year && boardRelatedFiling(filing))
      .slice(0, 4)
      .map((filing) => ({
        label: `${filing.date} · ${filing.description || filing.type}`,
        date: filing.date,
        reference: filing.id,
        snippet: `${filing.type} · ${filing.description}`,
        url: filing.download_url,
      }));

    addEvidenceFlag(
      {
        id: "board-instability",
        label: `Board instability: ${boardChanges.count} board filings in ${boardChanges.year}.`,
        severity: "warning",
        evidence: boardFilings,
      },
      2,
    );
  }

  const missingAnnual = filings.filter((filing) => filing.gap_flag);
  if (missingAnnual.length > 0) {
    addEvidenceFlag(
      {
        id: "annual-filing-gaps",
        label: `Missing annual filing years detected (${missingAnnual.length}).`,
        severity: "warning",
        evidence: missingAnnual.slice(0, 5).map((filing) => ({
          label: filing.description,
          date: filing.date,
          reference: filing.id,
          snippet: `${filing.type} · ${filing.description}`,
        })),
      },
      1,
    );
  } else {
    addEvidenceFlag(
      {
        id: "annual-filing-regular",
        label: "Annual accounts appear regularly filed without gaps.",
        severity: "info",
        evidence: filings
          .filter((filing) =>
            /annual|accounts|financial|οικονομ|ισολογ|χρηματοοικ/i.test(
              `${filing.type} ${filing.description}`,
            ),
          )
          .slice(0, 4)
          .map((filing) => ({
            label: filing.description || filing.type,
            date: filing.date,
            reference: filing.id,
            snippet: `${filing.type} · ${filing.description}`,
            url: filing.download_url,
          })),
      },
      -1,
    );
  }

  for (const director of raw.directors) {
    const dissolvedCount = director.other_directorships.filter(
      (role) => role.status === "dissolved",
    ).length;

    if (dissolvedCount >= 2) {
      addEvidenceFlag(
        {
          id: `director-${director.name}`,
          label: `${director.name} is linked to ${dissolvedCount} dissolved companies.`,
          severity: "warning",
          evidence: director.other_directorships
            .filter((role) => role.status === "dissolved")
            .slice(0, 4)
            .map((role) => ({
              label: `${role.company} (${role.gemi_number})`,
              reference: role.role,
              snippet: `Status: ${role.status}`,
            })),
        },
        1,
      );
    }
  }

  if (raw.source === "demo-fallback") {
    addEvidenceFlag(
      {
        id: "demo-fallback",
        label: "Live GEMI scrape failed; report used a deterministic fallback dataset.",
        severity: "warning",
        evidence: [{ label: raw.fallback_reason || "Upstream data source unavailable." }],
      },
      1,
    );
    confidencePoints = 1;
  }

  score = clamp(score, 0, 10);

  const confidence = confidencePoints >= 5 ? "high" : confidencePoints >= 3 ? "medium" : "low";
  const pdfsScanned = raw.financials
    .filter((entry) => Boolean(entry.download_url) && Boolean(entry.filename))
    .slice(0, 4).length;
  const confidenceSignals: string[] = [];

  if (raw.source === "live") {
    confidenceSignals.push("live GEMI payload");
  } else {
    confidenceSignals.push("fallback dataset");
  }
  if (filings.length >= 6) confidenceSignals.push(`${filings.length} filings`);
  if (raw.directors.length >= 2) confidenceSignals.push(`${raw.directors.length} director records`);
  if (raw.financials.length >= 2) confidenceSignals.push(`${raw.financials.length} financial records`);
  if (pdfsScanned > 0) confidenceSignals.push(`${pdfsScanned} PDFs scanned`);

  const confidenceReason = (() => {
    const sourceText = confidenceSignals.join(", ");
    if (confidence === "high") {
      return `High confidence: ${sourceText}.`;
    }
    if (confidence === "medium") {
      return `Medium confidence: ${sourceText}. Validate critical filings before final decisions.`;
    }
    return `Low confidence: ${sourceText}. Treat output as preliminary screening.`;
  })();

  const primarySummary =
    score >= 7
      ? "High-risk posture due to multiple structural and filing quality concerns."
      : score >= 4
        ? "Medium-risk posture with targeted governance and compliance concerns."
        : "Low-risk posture from available public data, with no major warning indicators.";

  const foundedYear = parseYear(raw.company.founded)
    ? `${parseYear(raw.company.founded)}`
    : raw.company.founded;
  const flatFlags = Array.from(new Set(evidenceFlags.map((flag) => flag.label)));
  const evidencePoints = evidenceFlags.reduce((total, item) => total + item.evidence.length, 0);

  return {
    company: {
      name: raw.company.name,
      legal_form: raw.company.legal_form || "Unknown",
      gemi_number: raw.company.gemi_number,
      vat: raw.company.vat,
      status: mapCompanyStatus(raw.company.status),
      address: raw.company.address,
      website: raw.company.website,
      activity_code: raw.company.activity_code || "",
      activity_description: raw.company.activity_description || "",
      founded: foundedYear || "Unknown",
    },
    capital: {
      current_amount: toNumber(raw.capital.total),
      currency: "EUR",
      raw_total: raw.capital.total,
      last_changed: raw.capital.last_changed,
      history: raw.capital.history,
    },
    directors: raw.directors.map((director) => ({
      name: director.name,
      role: director.role || "Board Member",
      appointed: director.appointed || "Unknown",
      tenure: director.tenure || "Unknown",
      status: director.status || "Unknown",
      other_directorships: director.other_directorships,
      flag:
        director.other_directorships.filter((item) => item.status === "dissolved").length >= 2
          ? `Director associated with ${director.other_directorships.filter((item) => item.status === "dissolved").length} dissolved entities`
          : undefined,
    })),
    shareholders: raw.shareholders,
    filings,
    financials: raw.financials,
    news: raw.news,
    risk: {
      score,
      confidence,
      confidence_reason: confidenceReason,
      base_score: baseScore,
      score_factors: scoreFactors,
      flags: flatFlags,
      evidence_flags: evidenceFlags,
      summary: [primarySummary, ...flatFlags.slice(0, 2)].join(" "),
    },
    source_quality: {
      filings_parsed: filings.length,
      financial_records: raw.financials.length,
      pdfs_scanned: pdfsScanned,
      evidence_points: evidencePoints,
      updated_at: raw.scraped_at || new Date().toISOString(),
    },
    ai_narrative: `${raw.company.name} (${raw.company.legal_form || "Unknown legal form"}) currently profiles as ${
      score >= 7 ? "elevated risk" : score >= 4 ? "medium risk" : "lower risk"
    } based on public GEMI registry disclosures. Governance cadence and filing consistency were reviewed against recent board activity, annual statements, and auditor continuity. Priority follow-up should focus on validating filing execution quality and confirming governance stability before relying on this profile for a transaction decision.`,
    generated_at: new Date().toISOString(),
    data_source: raw.source,
  };
}

function mergeAIOutput(base: GEMIReport, ai: unknown): GEMIReport {
  if (!ai || typeof ai !== "object") {
    return base;
  }

  const payload = ai as Record<string, unknown>;

  const summary =
    payload.risk && typeof payload.risk === "object"
      ? (payload.risk as Record<string, unknown>).summary
      : undefined;
  const score =
    payload.risk && typeof payload.risk === "object"
      ? (payload.risk as Record<string, unknown>).score
      : undefined;
  const flags =
    payload.risk && typeof payload.risk === "object"
      ? (payload.risk as Record<string, unknown>).flags
      : undefined;
  const narrative = payload.ai_narrative;

  const mergedFlags = [
    ...base.risk.flags,
    ...(Array.isArray(flags) ? flags.filter((item): item is string => typeof item === "string") : []),
  ];

  return {
    ...base,
    risk: {
      score:
        typeof score === "number"
          ? clamp(Math.round((base.risk.score + score) / 2), 0, 10)
          : base.risk.score,
      summary: typeof summary === "string" && summary.length > 0 ? summary : base.risk.summary,
      flags: Array.from(new Set(mergedFlags)).slice(0, 8),
      evidence_flags: base.risk.evidence_flags,
      confidence: base.risk.confidence,
      confidence_reason: base.risk.confidence_reason,
      base_score: base.risk.base_score,
      score_factors: base.risk.score_factors,
    },
    source_quality: base.source_quality,
    ai_narrative:
      typeof narrative === "string" && narrative.length > 0 ? narrative : base.ai_narrative,
    generated_at: new Date().toISOString(),
  };
}

async function synthesizeWithOpenAI(
  raw: GEMIRawData,
  openaiApiKey?: string,
): Promise<unknown | null> {
  if (!openaiApiKey) {
    return null;
  }

  const client = new OpenAI({ apiKey: openaiApiKey, timeout: 20000 });

  const completion = await client.chat.completions.create({
    model: env.openAiModel,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: AI_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Analyze this GEMI payload and refine legal risk commentary:\n${JSON.stringify(raw)}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return null;
  }

  return JSON.parse(content) as unknown;
}

async function synthesizeWithGemini(
  raw: GEMIRawData,
  geminiApiKey?: string,
): Promise<unknown | null> {
  if (!geminiApiKey) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    env.geminiModel,
  )}:generateContent`;

  const geminiController = new AbortController();
  const geminiTimer = setTimeout(() => geminiController.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${AI_SYSTEM_PROMPT}\n\nAnalyze this GEMI payload and refine legal risk commentary:\n${JSON.stringify(raw)}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
      cache: "no-store",
      signal: geminiController.signal,
    });
  } finally {
    clearTimeout(geminiTimer);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini request failed (${response.status})`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

export async function synthesizeReport(
  raw: GEMIRawData,
  apiKeys: UserApiKeys = {},
): Promise<GEMIReport> {
  const heuristic = buildHeuristicReport(raw);

  if (!hasUserAiKey(apiKeys)) {
    return heuristic;
  }

  try {
    const primary = apiKeys.geminiApiKey
      ? await synthesizeWithGemini(raw, apiKeys.geminiApiKey)
      : await synthesizeWithOpenAI(raw, apiKeys.openaiApiKey);

    if (primary) {
      return mergeAIOutput(heuristic, primary);
    }
  } catch {
    // fallback below
  }

  try {
    const secondary = apiKeys.geminiApiKey
      ? await synthesizeWithOpenAI(raw, apiKeys.openaiApiKey)
      : await synthesizeWithGemini(raw, apiKeys.geminiApiKey);

    if (secondary) {
      return mergeAIOutput(heuristic, secondary);
    }
  } catch {
    // fallback below
  }

  return heuristic;
}
