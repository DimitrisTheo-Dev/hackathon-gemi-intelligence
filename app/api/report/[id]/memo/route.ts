import { NextResponse } from "next/server";

import { createPdfErrorResponse, launchChromiumForPdf } from "@/lib/pdf-export";
import { getReport } from "@/lib/store";
import type { GEMIReport } from "@/lib/types";
import { makeSlug } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function riskColor(score: number): string {
  if (score <= 3) return "#2ad28d";
  if (score <= 6) return "#f6b66f";
  return "#ff6b6b";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildRecommendations(report: GEMIReport): string[] {
  const flags = report.risk.evidence_flags ?? [];
  const recommendations: string[] = [];

  if (flags.some((item) => item.id.includes("unsigned"))) {
    recommendations.push(
      "Obtain signed copies of annual financial statements and confirm filing replacement timeline.",
    );
  }
  if (flags.some((item) => item.id.includes("auditor-switch"))) {
    recommendations.push(
      "Request management memo explaining auditor transition, scope changes, and any dispute history.",
    );
  }
  if (flags.some((item) => item.id.includes("board-instability"))) {
    recommendations.push(
      "Review board and shareholder resolutions for the last 24 months and validate current mandates.",
    );
  }
  if (flags.some((item) => item.id.includes("annual-filing-gaps"))) {
    recommendations.push(
      "Reconcile statutory filing calendar and obtain missing annual-account submissions from registry or counsel.",
    );
  }
  if (flags.some((item) => item.id.includes("pdf-qualified-opinion"))) {
    recommendations.push(
      "Escalate qualified/adverse/disclaimer opinion findings to finance diligence with remediation requests.",
    );
  }
  if (report.news.some((item) => item.sentiment === "negative")) {
    recommendations.push(
      "Perform focused media/legal checks for negative news items and map to regulatory exposure.",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Proceed with standard confirmatory diligence (corporate records, tax, litigation, and banking confirmations).",
    );
  }

  return recommendations.slice(0, 6);
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

interface AdvisorSummaryPayload {
  include_advisor?: boolean;
  advisor_memo?: string;
  advisor_verdict?: string;
  advisor_generated_by?: "ai" | "deterministic";
  advisor_metadata?: {
    evidencePoints?: number;
    filingsParsed?: number;
    pdfScanned?: number;
    generatedAt?: string;
  };
  scenario_label?: string;
}

function buildMemoHtml(report: GEMIReport, advisor?: AdvisorSummaryPayload): string {
  const color = riskColor(report.risk.score);
  const recommendations = buildRecommendations(report);
  const evidenceFlags = report.risk.evidence_flags.slice(0, 8);
  const factors = (report.risk.score_factors ?? []).slice(0, 10);
  const sourceQuality = report.source_quality ?? {
    filings_parsed: report.filings.length,
    financial_records: report.financials.length,
    pdfs_scanned: report.financials
      .filter((item) => Boolean(item.download_url) && Boolean(item.filename))
      .slice(0, 4).length,
    evidence_points: evidenceFlags.reduce((sum, flag) => sum + flag.evidence.length, 0),
    updated_at: report.generated_at,
  };

  const flagsHtml = evidenceFlags
    .map((flag) => {
      const sources = flag.evidence
        .slice(0, 3)
        .map((source) => {
          const label = escapeHtml(source.label);
          const ref = source.reference ? ` · ${escapeHtml(source.reference)}` : "";
          const date = source.date ? ` · ${escapeHtml(formatDate(source.date))}` : "";
          const snippet = source.snippet
            ? `<blockquote>${escapeHtml(source.snippet)}</blockquote>`
            : "";

          return `<li>${
            source.url
              ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${label}</a>`
              : `<span>${label}</span>`
          }<small>${ref}${date}</small>${snippet}</li>`;
        })
        .join("");

      return `<article class="flag">
        <h4>${escapeHtml(flag.label)}</h4>
        <p class="impact">Impact: ${flag.score_impact && flag.score_impact > 0 ? "+" : ""}${flag.score_impact ?? 0}</p>
        <ul>${sources || "<li><span>No source rows attached.</span></li>"}</ul>
      </article>`;
    })
    .join("");

  const factorsHtml =
    factors.length > 0
      ? factors
          .map(
            (factor) =>
              `<li><span>${escapeHtml(factor.label)}</span><b>${
                factor.impact > 0 ? "+" : ""
              }${factor.impact}</b></li>`,
          )
          .join("")
      : "<li><span>Baseline legal/compliance screening risk</span><b>+2</b></li>";

  const recommendationHtml = recommendations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  const shouldIncludeAdvisor = Boolean(
    advisor?.include_advisor && advisor.advisor_memo && advisor.advisor_memo.trim().length > 0,
  );

  const advisorMetadata = advisor?.advisor_metadata;
  const advisorQualityLine = advisorMetadata
    ? `${Number(advisorMetadata.filingsParsed || sourceQuality.filings_parsed)} filings · ${Number(
        advisorMetadata.pdfScanned || sourceQuality.pdfs_scanned,
      )} PDFs · ${Number(advisorMetadata.evidencePoints || sourceQuality.evidence_points)} evidence points`
    : `${sourceQuality.filings_parsed} filings · ${sourceQuality.pdfs_scanned} PDFs · ${sourceQuality.evidence_points} evidence points`;

  const advisorSection = shouldIncludeAdvisor
    ? `<section class="advisor-page">
      <h3>Executive Advisor Memo</h3>
      <h1>${escapeHtml(report.company.name)}</h1>
      <p class="meta">${escapeHtml(
        advisor?.scenario_label || "Current scenario",
      )} · Verdict: ${escapeHtml(advisor?.advisor_verdict || "N/A")}</p>
      <article class="advisor-box">
        ${escapeHtml(advisor?.advisor_memo || "").replace(/\n/g, "<br/>")}
      </article>
      <p class="quality">${escapeHtml(advisorQualityLine)} · Generated ${escapeHtml(
        formatDate(advisorMetadata?.generatedAt || new Date().toISOString()),
      )} · ${
        advisor?.advisor_generated_by === "ai" ? "AI synthesis" : "Deterministic synthesis"
      }</p>
    </section>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #0b1018; color: #e6ecf5; padding: 28px; }
    h1 { margin: 0 0 6px; font-size: 28px; line-height: 1.15; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    h3 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #93a8cd; }
    p { margin: 6px 0 0; color: #b8c2d6; line-height: 1.5; }
    .meta { color: #9fb1d4; margin-bottom: 14px; font-size: 13px; }
    .risk { border: 1px solid #273246; border-radius: 14px; padding: 18px; margin: 16px 0; background: #121a28; }
    .score { font-size: 54px; font-weight: 700; color: ${color}; margin: 8px 0 8px; line-height: 0.9; }
    .confidence { display: inline-block; border: 1px solid #395078; border-radius: 999px; padding: 3px 10px; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
    .card { border: 1px solid #273246; border-radius: 12px; padding: 14px; background: #0f1624; }
    .card ul { margin: 8px 0 0; padding-left: 18px; }
    .card li { margin: 6px 0; }
    .factors { margin: 0; padding: 0; list-style: none; }
    .factors li { border: 1px solid #273246; border-radius: 10px; background: #121c2d; padding: 8px 10px; margin: 7px 0; display: flex; justify-content: space-between; gap: 8px; }
    .factors b { color: #dce9ff; }
    .flag-list { display: grid; gap: 10px; }
    .flag { border: 1px solid #273246; border-radius: 12px; padding: 12px; background: #0f1624; }
    .flag h4 { margin: 0; font-size: 14px; }
    .impact { margin-top: 4px; color: #ffc9b8; font-size: 12px; }
    .flag ul { margin: 8px 0 0; padding-left: 18px; }
    .flag li { margin: 6px 0; color: #b7c5df; }
    .flag small { color: #8fa3c9; margin-left: 5px; }
    .flag a { color: #9fd2ff; text-decoration: none; }
    blockquote { margin: 5px 0 0; border-left: 2px solid #45628f; padding-left: 8px; color: #9eb5d9; font-size: 11px; }
    .recommendations li { margin: 8px 0; }
    .quality { margin-top: 10px; font-size: 12px; color: #90a6cc; }
    .advisor-page { page-break-after: always; min-height: 100vh; padding-bottom: 10px; }
    .advisor-box { border: 1px solid #273246; border-radius: 12px; padding: 14px; margin-top: 10px; background: #0f1624; color: #d8e4fb; line-height: 1.65; font-size: 15px; }
  </style>
</head>
<body>
  ${advisorSection}
  <h3>Investment Committee Memo</h3>
  <h1>${escapeHtml(report.company.name)}</h1>
  <div class="meta">${escapeHtml(report.company.legal_form)} · GEMI ${escapeHtml(
    report.company.gemi_number,
  )} · Generated ${escapeHtml(formatDate(report.generated_at))}</div>

  <div class="risk">
    <strong>Executive Summary</strong>
    <div class="score">${report.risk.score} / 10</div>
    <div class="confidence">Confidence: ${escapeHtml(report.risk.confidence)}</div>
    <p>${escapeHtml(report.risk.summary)}</p>
    <p>${escapeHtml(report.ai_narrative)}</p>
    <div class="quality">
      ${sourceQuality.filings_parsed} filings parsed · ${sourceQuality.financial_records} financial records · ${
        sourceQuality.pdfs_scanned
      } PDFs scanned · ${sourceQuality.evidence_points} evidence points · Updated ${escapeHtml(
        formatDate(sourceQuality.updated_at),
      )}
    </div>
  </div>

  <div class="grid">
    <section class="card">
      <h2>Risk Factor Weights</h2>
      <ul class="factors">${factorsHtml}</ul>
      <p>${escapeHtml(
        report.risk.confidence_reason ||
          "Confidence is based on available filings, directors, and financial records.",
      )}</p>
    </section>

    <section class="card">
      <h2>Recommended Follow-Ups</h2>
      <ul class="recommendations">${recommendationHtml}</ul>
    </section>
  </div>

  <section style="margin-top: 14px;">
    <h2>Evidence-Backed Flags</h2>
    <div class="flag-list">${flagsHtml || "<p>No flags generated.</p>"}</div>
  </section>
</body>
</html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const record = await getReport(id);

  if (!record) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => ({}))) as AdvisorSummaryPayload;
  const html = buildMemoHtml(record.report, payload);
  let browser: Awaited<ReturnType<typeof launchChromiumForPdf>> | null = null;

  try {
    browser = await launchChromiumForPdf();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });

    const fileName = `${makeSlug(record.report.company.name) || "gemi-report"}-ic-memo.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("[api/report/[id]/memo] Failed to generate PDF memo", error);
    return createPdfErrorResponse(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
