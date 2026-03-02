import { hasUserAiKey, hasUserNewsKey, type UserApiKeys } from "@/lib/api-keys";
import { normalizeFilingsWithGaps } from "@/lib/analysis";
import { synthesizeReport } from "@/lib/ai/synthesize";
import { fetchRecentNews } from "@/lib/enrichment/news";
import { analyzeFinancialPdfSignals } from "@/lib/enrichment/financialPdf";
import { GEMIRegistryNotFoundError, scrapeGEMI } from "@/lib/scraper/gemi";
import { enrichDirectors } from "@/lib/scraper/directors";
import {
  emitSearchEvent,
  findCachedReportByGemi,
  saveReport,
  updateSearch,
} from "@/lib/store";
import type { PipelineStage } from "@/lib/types";
import { sleep } from "@/lib/utils";

const stageProgress: Record<PipelineStage, number> = {
  searching_gemi: 10,
  extracting: 30,
  directors: 48,
  filings: 66,
  news: 78,
  ai_analysis: 90,
  complete: 100,
  error: 100,
};

function emit(searchId: string, stage: PipelineStage, message: string, reportId?: string): void {
  emitSearchEvent(searchId, {
    stage,
    message,
    progress: stageProgress[stage],
    timestamp: new Date().toISOString(),
    report_id: reportId,
  });
}

export async function runPipeline(
  searchId: string,
  query: string,
  apiKeys: UserApiKeys,
): Promise<void> {
  try {
    emit(searchId, "searching_gemi", "Searching GEMI registry...");
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: "Searching GEMI registry...",
    });

    const raw = await scrapeGEMI(query);

    await updateSearch(searchId, {
      gemi_number: raw.company.gemi_number,
      company_name: raw.company.name,
      status: "scraping",
      current_stage: "Extracting company structure...",
    });

    const shouldBypassCache = hasUserAiKey(apiKeys) || hasUserNewsKey(apiKeys);
    const canUseCache =
      raw.source === "live" &&
      Boolean(raw.company.gemi_number) &&
      raw.company.gemi_number !== "000000000000" &&
      !shouldBypassCache;

    if (canUseCache) {
      const cached = await findCachedReportByGemi(raw.company.gemi_number);
      if (cached) {
        await updateSearch(searchId, {
          status: "complete",
          current_stage: "Report ready",
          completed_at: new Date().toISOString(),
          report_id: cached.id,
        });

        emit(searchId, "complete", "Report ready", cached.id);
        return;
      }
    }

    emit(searchId, "extracting", "Extracting company structure...");
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: "Extracting company structure...",
    });
    await sleep(250);

    emit(
      searchId,
      "directors",
      `Mapping ${raw.directors.length} directors and shareholders...`,
    );
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: `Mapping ${raw.directors.length} directors and shareholders...`,
    });
    raw.directors = await enrichDirectors(raw.directors);

    emit(searchId, "filings", `Analyzing ${raw.filings.length} filed documents...`);
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: `Analyzing ${raw.filings.length} filed documents...`,
    });
    raw.filings = normalizeFilingsWithGaps(raw.filings).map((filing) => ({
      id: filing.id ?? "",
      date: filing.date,
      type: filing.type,
      description: filing.description,
      download_url: filing.download_url,
    }));

    emit(searchId, "filings", "Scanning financial statement PDFs for signatures and opinions...");
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: "Scanning financial statement PDFs for signatures and opinions...",
    });
    raw.flags.pdf_signals = await analyzeFinancialPdfSignals(raw.financials);

    emit(searchId, "news", "Scanning recent news...");
    await updateSearch(searchId, {
      status: "scraping",
      current_stage: "Scanning recent news...",
    });
    raw.news = await fetchRecentNews(raw.company.name, apiKeys.serpApiKey);

    emit(searchId, "ai_analysis", "AI building risk assessment...");
    await updateSearch(searchId, {
      status: "analyzing",
      current_stage: "AI building risk assessment...",
    });

    const report = await synthesizeReport(raw, apiKeys);
    const saved = await saveReport(searchId, report);

    await updateSearch(searchId, {
      status: "complete",
      current_stage: "Report ready",
      completed_at: new Date().toISOString(),
      report_id: saved.id,
    });

    emit(searchId, "complete", "Report ready", saved.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const userFacingMessage =
      error instanceof GEMIRegistryNotFoundError
        ? "Company not found in GEMI registry. Please try a different company name, GEMI number, or VAT."
        : message;

    await updateSearch(searchId, {
      status: "failed",
      error: userFacingMessage,
      current_stage: "Pipeline failed",
      completed_at: new Date().toISOString(),
    });

    emit(searchId, "error", userFacingMessage);
  }
}
