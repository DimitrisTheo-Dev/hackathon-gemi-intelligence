import { chromium } from "playwright";
import { NextResponse } from "next/server";

import { getReport, getReportByShareToken } from "@/lib/store";
import { makeSlug } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verdict(score: number): string {
  if (score <= 3) return "PROCEED";
  if (score <= 7) return "PROCEED WITH CONDITIONS";
  return "DO NOT PROCEED";
}

async function resolveReport(slug: string) {
  return (await getReport(slug)) || (await getReportByShareToken(slug));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slugA: string; slugB: string }> },
): Promise<Response> {
  const { slugA, slugB } = await params;
  const [left, right] = await Promise.all([resolveReport(slugA), resolveReport(slugB)]);

  if (!left || !right) {
    return NextResponse.json({ error: "One or both reports were not found." }, { status: 404 });
  }

  const leftReport = left.report;
  const rightReport = right.report;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #0b1018; color: #e6ecf5; padding: 28px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    p { color: #b8c2d6; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #273246; padding: 10px; text-align: left; }
    th { background: #162237; }
    td { background: #101826; }
    .good { background: #133026; color: #aef6cf; }
  </style>
</head>
<body>
  <h1>GEMI Comparison Report</h1>
  <p>${escapeHtml(leftReport.company.name)} vs ${escapeHtml(rightReport.company.name)}</p>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>${escapeHtml(leftReport.company.name)}</th>
        <th>${escapeHtml(rightReport.company.name)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Risk Score</td>
        <td class="${leftReport.risk.score < rightReport.risk.score ? "good" : ""}">${leftReport.risk.score}</td>
        <td class="${rightReport.risk.score < leftReport.risk.score ? "good" : ""}">${rightReport.risk.score}</td>
      </tr>
      <tr>
        <td>Capital (EUR)</td>
        <td>${Math.round(leftReport.capital.current_amount)}</td>
        <td>${Math.round(rightReport.capital.current_amount)}</td>
      </tr>
      <tr>
        <td>Director Count</td>
        <td>${leftReport.directors.length}</td>
        <td>${rightReport.directors.length}</td>
      </tr>
      <tr>
        <td>Filings Count</td>
        <td>${leftReport.filings.length}</td>
        <td>${rightReport.filings.length}</td>
      </tr>
      <tr>
        <td>PDFs Scanned</td>
        <td>${leftReport.source_quality?.pdfs_scanned ?? 0}</td>
        <td>${rightReport.source_quality?.pdfs_scanned ?? 0}</td>
      </tr>
      <tr>
        <td>Analyst Verdict</td>
        <td>${verdict(leftReport.risk.score)}</td>
        <td>${verdict(rightReport.risk.score)}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });

    const leftSlug = makeSlug(leftReport.company.name) || "left";
    const rightSlug = makeSlug(rightReport.company.name) || "right";
    const fileName = `${leftSlug}-vs-${rightSlug}-comparison.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } finally {
    await browser.close();
  }
}
