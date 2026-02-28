import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { getSupabaseServerClient } from "@/lib/supabase";
import type {
  GEMIReport,
  ReportRecord,
  SearchEvent,
  SearchRecord,
  SearchStatus,
} from "@/lib/types";

const searches = new Map<string, SearchRecord>();
const reports = new Map<string, ReportRecord>();
const reportByGemi = new Map<string, string>();
const reportByToken = new Map<string, string>();
const latestSearchEvents = new Map<string, SearchEvent>();

const bus = new EventEmitter();

const RUNTIME_DIR = path.join(process.cwd(), ".runtime");
const STORE_FILE = path.join(RUNTIME_DIR, "gemi-store.json");

let supabaseDisabled = false;
let diskLoaded = false;

interface DiskState {
  searches: Record<string, SearchRecord>;
  reports: Record<string, ReportRecord>;
  reportByGemi: Record<string, string>;
  reportByToken: Record<string, string>;
  latestSearchEvents: Record<string, SearchEvent>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSearchRecord(row: Record<string, unknown>): SearchRecord {
  return {
    id: String(row.id),
    query: String(row.query ?? ""),
    gemi_number: row.gemi_number ? String(row.gemi_number) : undefined,
    company_name: row.company_name ? String(row.company_name) : undefined,
    status: (row.status as SearchStatus) ?? "pending",
    current_stage: String(row.current_stage ?? ""),
    error: row.error ? String(row.error) : undefined,
    created_at: String(row.created_at ?? nowIso()),
    updated_at: String(row.updated_at ?? row.created_at ?? nowIso()),
    completed_at: row.completed_at ? String(row.completed_at) : undefined,
    report_id: row.report_id ? String(row.report_id) : undefined,
  };
}

function toReportRecord(row: Record<string, unknown>): ReportRecord {
  const record: ReportRecord = {
    id: String(row.id),
    search_id: String(row.search_id ?? ""),
    gemi_number: String(row.gemi_number ?? ""),
    company_name: String(row.company_name ?? ""),
    report: row.report as GEMIReport,
    risk_score: Number(row.risk_score ?? 0),
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    share_token: String(row.share_token ?? randomUUID()),
    created_at: String(row.created_at ?? nowIso()),
  };

  return sanitizeReportRecord(record);
}

function sanitizeReport(report: GEMIReport): GEMIReport {
  const derivedConfidence = (() => {
    let points = 0;
    if (report.data_source === "live") points += 2;
    if (report.financials.length >= 2) points += 1;
    if (report.filings.length >= 6) points += 1;
    if (report.directors.length >= 2) points += 1;
    if (report.risk?.flags?.length) points += 1;
    if (points >= 5) return "high";
    if (points >= 3) return "medium";
    return "low";
  })();

  const normalizedRisk = {
    score: Number.isFinite(report.risk?.score) ? report.risk.score : 0,
    confidence: (() => {
      const hasEvidence = Array.isArray(report.risk?.evidence_flags) && report.risk.evidence_flags.length > 0;
      const hasExplicitConfidence =
        report.risk?.confidence === "high" ||
        report.risk?.confidence === "medium" ||
        report.risk?.confidence === "low";

      if (!hasEvidence && report.data_source === "live") {
        return derivedConfidence;
      }

      if (hasExplicitConfidence) {
        return report.risk.confidence;
      }

      return derivedConfidence;
    })(),
    confidence_reason:
      typeof report.risk?.confidence_reason === "string" && report.risk.confidence_reason.length > 0
        ? report.risk.confidence_reason
        : derivedConfidence === "high"
          ? "High confidence: score is supported by multiple filings, directors, and financial records."
          : derivedConfidence === "medium"
            ? "Medium confidence: score is based on partial evidence. Verify key filings before decisions."
            : "Low confidence: limited evidence available. Treat this as preliminary screening output.",
    base_score: Number.isFinite(report.risk?.base_score) ? report.risk.base_score : 2,
    score_factors: Array.isArray(report.risk?.score_factors)
      ? report.risk.score_factors.filter((item) => item && typeof item.label === "string")
      : [
          {
            id: "baseline",
            label: "Baseline legal/compliance screening risk",
            impact: Number.isFinite(report.risk?.base_score) ? report.risk.base_score : 2,
          },
        ],
    flags: Array.isArray(report.risk?.flags) ? report.risk.flags : [],
    evidence_flags: Array.isArray(report.risk?.evidence_flags)
      ? report.risk.evidence_flags
      : [],
    summary: typeof report.risk?.summary === "string" ? report.risk.summary : "",
  } as GEMIReport["risk"];

  const sourceQuality = report.source_quality;
  const sourceFilingsParsed = Number(sourceQuality?.filings_parsed);
  const sourceFinancialRecords = Number(sourceQuality?.financial_records);
  const sourcePdfsScanned = Number(sourceQuality?.pdfs_scanned);
  const sourceEvidencePoints = Number(sourceQuality?.evidence_points);

  const normalizedSourceQuality = {
    filings_parsed: Number.isFinite(sourceFilingsParsed)
      ? sourceFilingsParsed
      : report.filings.length,
    financial_records: Number.isFinite(sourceFinancialRecords)
      ? sourceFinancialRecords
      : report.financials.length,
    pdfs_scanned: Number.isFinite(sourcePdfsScanned)
      ? sourcePdfsScanned
      : report.financials
          .filter((entry) => Boolean(entry.download_url) && Boolean(entry.filename))
          .slice(0, 4).length,
    evidence_points: Number.isFinite(sourceEvidencePoints)
      ? sourceEvidencePoints
      : normalizedRisk.evidence_flags.reduce((total, item) => total + item.evidence.length, 0),
    updated_at:
      typeof sourceQuality?.updated_at === "string" && sourceQuality.updated_at.length > 0
        ? sourceQuality.updated_at
        : report.generated_at,
  };

  const seen = new Set<string>();
  const dedupedFinancials = report.financials.filter((entry) => {
    const key = String(
      entry.download_url ||
        `${entry.period}|${entry.filename}|${entry.auditor || ""}`,
    );
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const shareholderMap = new Map<string, GEMIReport["shareholders"][number]>();
  for (const holder of report.shareholders) {
    const name = String(holder.name || "").trim();
    if (!name) {
      continue;
    }

    const key = `${name.toLowerCase()}|${holder.entity_type}`;
    const existing = shareholderMap.get(key);
    if (!existing) {
      shareholderMap.set(key, holder);
      continue;
    }

    if ((holder.percentage || 0) > (existing.percentage || 0)) {
      shareholderMap.set(key, holder);
    }
  }

  const normalizedShareholders = [...shareholderMap.values()].filter(
    (holder) => Number.isFinite(holder.percentage) && holder.percentage > 0,
  );

  const riskChanged =
    report.risk?.confidence !== normalizedRisk.confidence ||
    report.risk?.confidence_reason !== normalizedRisk.confidence_reason ||
    report.risk?.base_score !== normalizedRisk.base_score ||
    !Array.isArray(report.risk?.score_factors) ||
    !Array.isArray(report.risk?.evidence_flags) ||
    !Array.isArray(report.risk?.flags) ||
    typeof report.risk?.summary !== "string";

  const sourceQualityChanged =
    !report.source_quality ||
    report.source_quality.filings_parsed !== normalizedSourceQuality.filings_parsed ||
    report.source_quality.financial_records !== normalizedSourceQuality.financial_records ||
    report.source_quality.pdfs_scanned !== normalizedSourceQuality.pdfs_scanned ||
    report.source_quality.evidence_points !== normalizedSourceQuality.evidence_points ||
    report.source_quality.updated_at !== normalizedSourceQuality.updated_at;

  const shareholdersChanged =
    normalizedShareholders.length !== report.shareholders.length ||
    normalizedShareholders.some((holder, index) => holder !== report.shareholders[index]);

  if (
    dedupedFinancials.length === report.financials.length &&
    !riskChanged &&
    !shareholdersChanged &&
    !sourceQualityChanged
  ) {
    return report;
  }

  return {
    ...report,
    risk: normalizedRisk,
    source_quality: normalizedSourceQuality,
    shareholders: normalizedShareholders,
    financials: dedupedFinancials,
  };
}

function sanitizeReportRecord(record: ReportRecord): ReportRecord {
  const sanitizedReport = sanitizeReport(record.report);
  if (sanitizedReport === record.report) {
    return record;
  }

  return {
    ...record,
    report: sanitizedReport,
    risk_score: sanitizedReport.risk.score,
    flags: sanitizedReport.risk.flags,
  };
}

function loadDiskStateUnsafe(): DiskState | null {
  if (!existsSync(STORE_FILE)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Partial<DiskState>;
    return {
      searches: parsed.searches ?? {},
      reports: parsed.reports ?? {},
      reportByGemi: parsed.reportByGemi ?? {},
      reportByToken: parsed.reportByToken ?? {},
      latestSearchEvents: parsed.latestSearchEvents ?? {},
    };
  } catch {
    return null;
  }
}

function persistDiskStateUnsafe(): void {
  const state: DiskState = {
    searches: Object.fromEntries(searches.entries()),
    reports: Object.fromEntries(reports.entries()),
    reportByGemi: Object.fromEntries(reportByGemi.entries()),
    reportByToken: Object.fromEntries(reportByToken.entries()),
    latestSearchEvents: Object.fromEntries(latestSearchEvents.entries()),
  };

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(state), "utf8");
}

function syncFromDisk(): void {
  const disk = loadDiskStateUnsafe();
  if (!disk) {
    return;
  }

  for (const [id, record] of Object.entries(disk.searches)) {
    searches.set(id, record);
  }

  for (const [id, record] of Object.entries(disk.reports)) {
    reports.set(id, record);
  }

  for (const [key, value] of Object.entries(disk.reportByGemi)) {
    reportByGemi.set(key, value);
  }

  for (const [key, value] of Object.entries(disk.reportByToken)) {
    reportByToken.set(key, value);
  }

  for (const [key, value] of Object.entries(disk.latestSearchEvents)) {
    latestSearchEvents.set(key, value);
  }
}

function ensureLoaded(): void {
  if (diskLoaded) {
    syncFromDisk();
    return;
  }

  syncFromDisk();
  diskLoaded = true;
}

async function maybeSupabase<T>(
  fn: (client: NonNullable<ReturnType<typeof getSupabaseServerClient>>) => Promise<T>,
): Promise<T | null> {
  if (supabaseDisabled) {
    return null;
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return null;
  }

  try {
    return await fn(client);
  } catch (error) {
    console.warn("[supabase] disabled after error:", error);
    supabaseDisabled = true;
    return null;
  }
}

export async function createSearch(query: string): Promise<SearchRecord> {
  ensureLoaded();

  const record: SearchRecord = {
    id: randomUUID(),
    query,
    status: "pending",
    current_stage: "Queued",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  searches.set(record.id, record);
  persistDiskStateUnsafe();

  await maybeSupabase(async (client) => {
    await client.from("searches").insert({
      id: record.id,
      query: record.query,
      status: record.status,
      current_stage: record.current_stage,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
    return null;
  });

  return record;
}

export async function getSearch(id: string): Promise<SearchRecord | null> {
  ensureLoaded();

  const local = searches.get(id);
  if (local) {
    return local;
  }

  const row = await maybeSupabase(async (client) => {
    const { data, error } = await client
      .from("searches")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return toSearchRecord(data as Record<string, unknown>);
  });

  if (!row) {
    return null;
  }

  searches.set(row.id, row);
  persistDiskStateUnsafe();
  return row;
}

export async function updateSearch(
  id: string,
  patch: Partial<Omit<SearchRecord, "id" | "query" | "created_at">>,
): Promise<SearchRecord | null> {
  ensureLoaded();

  const current = await getSearch(id);
  if (!current) {
    return null;
  }

  const next: SearchRecord = {
    ...current,
    ...patch,
    updated_at: nowIso(),
  };

  searches.set(id, next);
  persistDiskStateUnsafe();

  await maybeSupabase(async (client) => {
    const payload: Record<string, unknown> = {
      status: next.status,
      current_stage: next.current_stage,
      gemi_number: next.gemi_number,
      company_name: next.company_name,
      error: next.error,
      updated_at: next.updated_at,
      completed_at: next.completed_at,
      report_id: next.report_id,
    };

    await client.from("searches").update(payload).eq("id", id);
    return null;
  });

  return next;
}

export function emitSearchEvent(searchId: string, event: SearchEvent): void {
  ensureLoaded();

  latestSearchEvents.set(searchId, event);
  persistDiskStateUnsafe();
  bus.emit(`search:${searchId}`, event);
}

export function getLatestSearchEvent(searchId: string): SearchEvent | null {
  ensureLoaded();
  return latestSearchEvents.get(searchId) ?? null;
}

export function subscribeToSearch(
  searchId: string,
  callback: (event: SearchEvent) => void,
): () => void {
  const key = `search:${searchId}`;
  bus.on(key, callback);
  return () => bus.off(key, callback);
}

export async function saveReport(searchId: string, report: GEMIReport): Promise<ReportRecord> {
  ensureLoaded();

  const sanitizedReport = sanitizeReport(report);

  const reportRecord: ReportRecord = {
    id: randomUUID(),
    search_id: searchId,
    gemi_number: sanitizedReport.company.gemi_number,
    company_name: sanitizedReport.company.name,
    report: sanitizedReport,
    risk_score: sanitizedReport.risk.score,
    flags: sanitizedReport.risk.flags,
    share_token: randomUUID(),
    created_at: nowIso(),
  };

  reports.set(reportRecord.id, reportRecord);
  reportByGemi.set(reportRecord.gemi_number, reportRecord.id);
  reportByToken.set(reportRecord.share_token, reportRecord.id);
  persistDiskStateUnsafe();

  await maybeSupabase(async (client) => {
    const { data } = await client
      .from("reports")
      .insert({
        id: reportRecord.id,
        search_id: reportRecord.search_id,
        gemi_number: reportRecord.gemi_number,
        company_name: reportRecord.company_name,
        report: reportRecord.report,
        risk_score: reportRecord.risk_score,
        flags: reportRecord.flags,
        share_token: reportRecord.share_token,
        created_at: reportRecord.created_at,
      })
      .select("*")
      .maybeSingle();

    if (data) {
      const persisted = toReportRecord(data as Record<string, unknown>);
      reports.set(persisted.id, persisted);
      reportByGemi.set(persisted.gemi_number, persisted.id);
      reportByToken.set(persisted.share_token, persisted.id);
      persistDiskStateUnsafe();
    }

    return null;
  });

  return reports.get(reportRecord.id) ?? reportRecord;
}

export async function getReport(id: string): Promise<ReportRecord | null> {
  ensureLoaded();

  const local = reports.get(id);
  if (local) {
    const sanitized = sanitizeReportRecord(local);
    if (sanitized !== local) {
      reports.set(id, sanitized);
      reportByGemi.set(sanitized.gemi_number, sanitized.id);
      reportByToken.set(sanitized.share_token, sanitized.id);
      persistDiskStateUnsafe();
    }
    return sanitized;
  }

  const row = await maybeSupabase(async (client) => {
    const { data, error } = await client
      .from("reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return toReportRecord(data as Record<string, unknown>);
  });

  if (!row) {
    return null;
  }

  reports.set(row.id, row);
  reportByGemi.set(row.gemi_number, row.id);
  reportByToken.set(row.share_token, row.id);
  persistDiskStateUnsafe();
  return row;
}

export async function getReportByShareToken(token: string): Promise<ReportRecord | null> {
  ensureLoaded();

  const localId = reportByToken.get(token);
  if (localId) {
    return getReport(localId);
  }

  const row = await maybeSupabase(async (client) => {
    const { data, error } = await client
      .from("reports")
      .select("*")
      .eq("share_token", token)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return toReportRecord(data as Record<string, unknown>);
  });

  if (!row) {
    return null;
  }

  reports.set(row.id, row);
  reportByGemi.set(row.gemi_number, row.id);
  reportByToken.set(row.share_token, row.id);
  persistDiskStateUnsafe();
  return row;
}

export async function findCachedReportByGemi(gemiNumber: string): Promise<ReportRecord | null> {
  ensureLoaded();

  const localId = reportByGemi.get(gemiNumber);
  if (localId) {
    const cached = await getReport(localId);
    if (cached) {
      return cached;
    }
  }

  const row = await maybeSupabase(async (client) => {
    const { data, error } = await client
      .from("reports")
      .select("*")
      .eq("gemi_number", gemiNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return toReportRecord(data as Record<string, unknown>);
  });

  if (!row) {
    return null;
  }

  reports.set(row.id, row);
  reportByGemi.set(row.gemi_number, row.id);
  reportByToken.set(row.share_token, row.id);
  persistDiskStateUnsafe();
  return row;
}
