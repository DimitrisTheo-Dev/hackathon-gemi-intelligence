import { PDFParse } from "pdf-parse";

import type { FinancialPdfSignal, RawFinancial } from "@/lib/types";
import { normalizeWhitespace } from "@/lib/utils";

const MAX_FILES_TO_SCAN = 4;
const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 14000;

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractSnippet(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  if (!match || typeof match.index !== "number") {
    return undefined;
  }

  const start = Math.max(0, match.index - 90);
  const end = Math.min(text.length, match.index + 120);
  return normalizeWhitespace(text.slice(start, end));
}

export async function analyzeFinancialPdfSignals(
  financials: RawFinancial[],
): Promise<FinancialPdfSignal[]> {
  const targets = financials
    .filter((entry) => Boolean(entry.download_url) && Boolean(entry.filename))
    .slice(0, MAX_FILES_TO_SCAN);

  const signals: FinancialPdfSignal[] = [];

  for (const entry of targets) {
    const downloadUrl = entry.download_url;
    if (!downloadUrl) {
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(downloadUrl, {
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        continue;
      }

      const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_PDF_SIZE_BYTES) {
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_SIZE_BYTES) {
        continue;
      }

      const parser = new PDFParse({ data: bytes });
      const parsed = await parser.getText({ first: 8 }).finally(async () => {
        await parser.destroy().catch(() => undefined);
      });

      const rawText = normalizeWhitespace(parsed.text || "");
      if (!rawText) {
        continue;
      }

      const searchable = normalizeForSearch(rawText);

      const unsignedPattern =
        /(unsigned|ανυπογραφ|χωρις υπογραφ|μη υπογεγραμμ|not signed)/i;
      const auditorOpinionPattern =
        /(auditor'?s opinion|independent auditor|εκθεση ελεγχ|γνωμη ελεγκτ|ελεγκτικη γνωμη)/i;
      const qualifiedPattern =
        /(qualified opinion|adverse opinion|disclaimer of opinion|γνωμη με επιφυλαξ|αρνητικη γνωμη|αδυναμια εκφρασης γνωμης|επιφυλαξ)/i;
      const signaturePattern =
        /(signed by|signature|υπογραφ|ορκωτ[οω]ς ελεγκτ|chartered accountant|certified public accountant)/i;

      const unsigned = unsignedPattern.test(searchable);
      const auditorOpinion = auditorOpinionPattern.test(searchable);
      const qualifiedOpinion = qualifiedPattern.test(searchable);
      const signatureMarker = signaturePattern.test(searchable);

      if (!unsigned && !auditorOpinion && !qualifiedOpinion && !signatureMarker) {
        continue;
      }

      signals.push({
        period: entry.period,
        filename: entry.filename,
        download_url: entry.download_url,
        unsigned,
        auditor_opinion: auditorOpinion,
        qualified_opinion: qualifiedOpinion,
        signature_marker: signatureMarker,
        excerpt:
          extractSnippet(searchable, unsignedPattern) ||
          extractSnippet(searchable, qualifiedPattern) ||
          extractSnippet(searchable, auditorOpinionPattern) ||
          extractSnippet(searchable, signaturePattern),
      });
    } catch {
      // Ignore per-file failures so the full report still completes.
    } finally {
      clearTimeout(timer);
    }
  }

  return signals;
}
