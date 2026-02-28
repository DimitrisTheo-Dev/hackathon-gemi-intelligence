import type { RawFiling, ReportFiling, RawFinancial } from "@/lib/types";
import { parseYear } from "@/lib/utils";

function filingYear(filing: { date: string; description: string; type: string }): number | null {
  return parseYear(filing.date) ?? parseYear(filing.description) ?? parseYear(filing.type);
}

function isAnnualFiling(filing: { type: string; description: string }): boolean {
  const source = `${filing.type} ${filing.description}`.toLowerCase();
  return /(annual|accounts|financial|οικονομ|ισολογ|χρηματοοικ)/.test(source);
}

export function normalizeFilingsWithGaps(rawFilings: RawFiling[]): ReportFiling[] {
  const base: ReportFiling[] = rawFilings.map((filing) => ({
    id: filing.id,
    type: filing.type || "Unknown filing",
    date: filing.date || "",
    description: filing.description || filing.type || "",
    download_url: filing.download_url,
    gap_flag: false,
  }));

  const annualYears = Array.from(
    new Set(
      base
        .filter(isAnnualFiling)
        .map((filing) => filingYear(filing))
        .filter((year): year is number => Boolean(year)),
    ),
  ).sort((a, b) => a - b);

  const missingYears: number[] = [];

  for (let idx = 1; idx < annualYears.length; idx += 1) {
    const previous = annualYears[idx - 1];
    const current = annualYears[idx];

    if (current - previous > 1) {
      for (let year = previous + 1; year < current; year += 1) {
        missingYears.push(year);
      }
    }
  }

  for (const year of missingYears) {
    base.push({
      type: "Missing Annual Accounts",
      date: `${year}-12-31`,
      description: `No annual accounts filing detected for ${year}`,
      gap_flag: true,
    });
  }

  return base.sort((a, b) => {
    const left = Date.parse(a.date || "1900-01-01");
    const right = Date.parse(b.date || "1900-01-01");
    return right - left;
  });
}

export function hasAuditorSwitch(financials: RawFinancial[]): { switched: boolean; from?: string; to?: string } {
  const ordered = [...financials].sort((a, b) => {
    const yearA = parseYear(a.period) ?? 0;
    const yearB = parseYear(b.period) ?? 0;
    return yearA - yearB;
  });

  const auditors = ordered.map((item) => item.auditor).filter(Boolean);
  if (auditors.length < 2) {
    return { switched: false };
  }

  const first = auditors[0];
  const last = auditors[auditors.length - 1];

  return {
    switched: first !== last,
    from: first,
    to: last,
  };
}

export function latestBoardChanges(filings: ReportFiling[]): { year: number | null; count: number } {
  const boardFilings = filings.filter((filing) => {
    const source = `${filing.type} ${filing.description}`.toLowerCase();
    return /(board|director|διοικητ|δ\.σ\.|διοικ)/.test(source);
  });

  const byYear = new Map<number, number>();

  for (const filing of boardFilings) {
    const year = filingYear(filing);
    if (!year) {
      continue;
    }

    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }

  if (byYear.size === 0) {
    return { year: null, count: 0 };
  }

  const latestYear = Math.max(...byYear.keys());
  return { year: latestYear, count: byYear.get(latestYear) ?? 0 };
}
