import { NextResponse } from "next/server";
import { chromium, type Browser } from "playwright";

import { getReport } from "@/lib/store";
import { makeSlug } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYWRIGHT_BROWSER_MISSING_MESSAGE =
  "PDF export unavailable: Playwright Chromium browser is missing in this runtime. Run `pnpm exec playwright install chromium` during setup/deploy.";

function riskColor(score: number): string {
  if (score <= 3) return "#2ad28d";
  if (score <= 6) return "#f6b66f";
  return "#ff6b6b";
}

function isPlaywrightBrowserMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist at") ||
    message.includes("download new browsers") ||
    message.includes("playwright install")
  );
}

async function launchChromiumForPdf(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!isPlaywrightBrowserMissing(error)) {
      throw error;
    }
    throw new Error(PLAYWRIGHT_BROWSER_MISSING_MESSAGE);
  }
}

function createPdfErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error && error.message ? error.message : "Failed to generate PDF.";
  if (message === PLAYWRIGHT_BROWSER_MISSING_MESSAGE) {
    return NextResponse.json(
      {
        code: "PLAYWRIGHT_BROWSER_MISSING",
        error: message,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const record = await getReport(id);

  if (!record) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const report = record.report;
  const color = riskColor(report.risk.score);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #0b1018; color: #e6ecf5; padding: 36px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { color: #b8c2d6; }
    .risk { border: 1px solid #273246; border-radius: 14px; padding: 20px; margin: 20px 0; background: #121a28; }
    .score { font-size: 54px; font-weight: 700; color: ${color}; margin: 8px 0 12px; }
    .card { border: 1px solid #273246; border-radius: 12px; padding: 16px; margin-top: 16px; background: #0f1624; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 6px 0; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
    .meta div { border: 1px solid #273246; border-radius: 10px; padding: 10px; }
  </style>
</head>
<body>
  <h1>${report.company.name}</h1>
  <p>${report.company.legal_form} • GEMI ${report.company.gemi_number}</p>

  <div class="risk">
    <strong>Risk Score</strong>
    <div class="score">${report.risk.score} / 10</div>
    <p>${report.risk.summary}</p>
    <ul>${report.risk.flags.map((flag) => `<li>${flag}</li>`).join("")}</ul>
  </div>

  <div class="meta">
    <div><strong>Status</strong><br/>${report.company.status}</div>
    <div><strong>Founded</strong><br/>${report.company.founded}</div>
    <div><strong>Capital</strong><br/>${report.capital.raw_total || report.capital.current_amount}</div>
    <div><strong>Activity</strong><br/>${report.company.activity_code || "n/a"}</div>
  </div>

  <div class="card">
    <strong>AI Narrative</strong>
    <p>${report.ai_narrative}</p>
  </div>
</body>
</html>`;

  let browser: Awaited<ReturnType<typeof launchChromiumForPdf>> | null = null;

  try {
    browser = await launchChromiumForPdf();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
    });

    const fileName = `${makeSlug(report.company.name) || "gemi-report"}-due-diligence.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("[api/report/[id]/pdf] Failed to generate PDF", error);
    return createPdfErrorResponse(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
