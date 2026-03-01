import { createHash } from "crypto";

import type {
  GEMISearchCandidate,
  GEMIRawData,
  RawDirector,
  RawFinancial,
  RawFiling,
  RawShareholder,
  ReportNews,
} from "@/lib/types";
import { normalizeWhitespace } from "@/lib/utils";

const BASE_URL = "https://publicity.businessportal.gr";

interface SearchHit {
  id?: string;
  gemiNumber?: string;
  afm?: string;
  legalType?: string;
  status?: string;
  name?: string;
  title?: string[];
  addressCity?: string;
  isSuspended?: boolean | null;
}

interface RankedHit {
  hit: SearchHit;
  score: number;
}

interface CompanyDetailsPayload {
  company?: {
    id?: string;
    name?: string;
    afm?: string;
    namei18n?: string | null;
    companyStatus?: { id?: number; status?: string };
    dateStart?: string;
    dateGemiRegistered?: string;
    legalType?: { id?: string; desc?: string };
    branchType?: string | null;
    isABranch?: boolean;
    isForeignBranch?: boolean;
    lock?: boolean;
    issuspended?: boolean;
    company_city?: string;
    company_street?: string;
    company_street_number?: string;
    company_region?: string;
    company_municipality?: string;
    company_zip_code?: string;
    companyWebsite?: string;
    companyEshop?: string;
  };
  capital?: Array<{
    descr?: string;
    amount?: string | number;
    nominal_price?: number;
    capital_stock?: string | number;
    company_id?: string;
    currency?: string;
  }>;
  decisions?: Array<{ id?: string; date_issued?: string; descr?: string }>;
  ModificationHistoryData?: Array<{
    id?: string;
    announcement_date?: string;
    registration_date?: string;
    system_file?: string;
    descr?: string;
    applicationStatusDescr?: string;
    kak?: string;
  }>;
  managementPersons?: Array<{
    id?: string;
    firstName?: string;
    lastName?: string;
    active?: number;
    afm?: string;
    dateFrom?: string;
    dateElection?: string;
    dateTo?: string | null;
    percentage?: string | number;
    capacityDescr?: string;
    tableName?: string;
    isCompany?: number;
  }>;
  moreInfo?: {
    telephone?: string;
    email?: string;
  };
  chamberInfo?: {
    chamberName?: string;
    chamberDepartment?: string;
    chamberRegistrationNumber?: string;
    chamberContactNumber?: string;
    chamberContactUrl?: string;
    companyDateRegisteredToChamber?: string;
  };
  kadData?: Array<{
    objective?: string;
    activities?: string;
    kad?: string;
    descr?: string;
  }>;
  representation?: Array<{
    firstName?: string;
    lastName?: string;
    afm?: string;
    dateFrom?: string;
    dateTo?: string | null;
    capacityDescr?: string;
    active?: number;
  }>;
  companyFinancial?: Array<{
    referencePeriod?: string;
    FilesAndAuditors?: Array<{
      balancesheet?: Array<{
        id?: number;
        balancesheet_id?: number;
        bal_date?: string;
        bal_file_system_file_path?: string;
      }>;
      auditors?: Array<{
        auditorName?: string;
        balancesheet_id?: number;
        companyName?: string;
        companyId?: number;
      }>;
    }>;
  }>;
  titles?: Array<{ title?: string; isEnable?: number }>;
  documents?: Array<{ id?: string; title?: string; descr?: string; cost?: number }>;
  YmsData?: Array<{
    id?: string;
    ymsDate?: string;
    ymsDescription?: string;
    ymsKak?: string;
  }>;
  statuteData?: Array<{ id?: string; date_created?: string; active?: number }>;
  authorityData?: Array<{ id?: string; date_org?: string; org?: string; subject?: string }>;
  restData?: Array<{ id?: string; date_issued?: string; descr?: string }>;
  suspension?: Array<unknown>;
  corporateStatusHistoryInfo?: Array<unknown>;
  companyStatusHistoryInfo?: Array<unknown>;
  activityRegionsInfo?: Array<unknown>;
}

function normalizeString(value: unknown): string {
  return normalizeWhitespace(typeof value === "string" || typeof value === "number" ? String(value) : "");
}

function parseFlexibleNumber(value: unknown): number | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/\s+/g, "");
  const commaIndex = compact.lastIndexOf(",");
  const dotIndex = compact.lastIndexOf(".");
  const decimalSeparator = commaIndex > dotIndex ? "," : ".";

  const digitsOnly = compact.replace(/[^\d,.-]/g, "");
  const normalizedNumber =
    decimalSeparator === ","
      ? digitsOnly.replace(/\./g, "").replace(",", ".")
      : digitsOnly.replace(/,/g, "");

  const parsed = Number.parseFloat(normalizedNumber);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGreekNumber(value: number, maxFractionDigits = 2): string {
  const isInt = Math.abs(value - Math.round(value)) < 1e-9;
  return new Intl.NumberFormat("el-GR", {
    minimumFractionDigits: isInt ? 0 : Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function normalizedComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function basenameFromPath(path: string): string {
  const normalized = path.replace(/^~\//, "").split("/");
  const raw = normalized[normalized.length - 1] || path;
  return normalizeWhitespace(raw.replace(/^\d{8}-\d{6}-/g, ""));
}

function fallbackRawData(query: string, reason: string): GEMIRawData {
  const displayName = query.trim().length > 0 ? query.trim().toUpperCase() : "UNKNOWN COMPANY";
  const hash = createHash("md5").update(displayName).digest("hex").slice(0, 11);
  const pseudoGemi = `9${hash
    .split("")
    .map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) % 10)))
    .join("")}`;

  return {
    source: "demo-fallback",
    fallback_reason: reason,
    company: {
      name: displayName,
      legal_form: "Unknown",
      gemi_number: pseudoGemi,
      vat: "",
      status: "unknown",
      address: "",
      website: undefined,
      founded: "",
      activity_code: "",
      activity_description: "",
    },
    capital: {
      total: "",
      shares: "",
      value: "",
      last_changed: "",
      history: [],
    },
    directors: [],
    shareholders: [],
    filings: [],
    financials: [],
    news: [],
    flags: {
      unsigned_financials: [],
      pdf_signals: [],
    },
    scraped_at: new Date().toISOString(),
  };
}

async function postPublicityApi<T>(path: string, body: unknown): Promise<T> {
  const maxAttempts = 3;
  const REQUEST_TIMEOUT_MS = 12000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    let text: string;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      clearTimeout(timer);
      if (attempt < maxAttempts) {
        const waitMs = Math.min(3000, 500 * attempt) + Math.floor(Math.random() * 100);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw new Error(`Publicity API ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Publicity API ${path} returned non-JSON payload`);
      }
    }

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      /too many requests/i.test(text);

    if (retryable && attempt < maxAttempts) {
      const waitMs = Math.min(3000, 500 * attempt) + Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    throw new Error(`Publicity API ${path} failed (${response.status}): ${text.slice(0, 240)}`);
  }

  throw new Error(`Publicity API ${path} failed after retries`);
}

function getSearchPayload(query: string): Record<string, unknown> {
  return {
    dataToBeSent: {
      inputField: query,
      city: null,
      postcode: null,
      legalType: [],
      status: [],
      suspension: [],
      category: [],
      specialCharacteristics: [],
      employeeNumber: [],
      armodiaGEMI: [],
      kad: [],
      recommendationDateFrom: null,
      recommendationDateTo: null,
      closingDateFrom: null,
      closingDateTo: null,
      alterationDateFrom: null,
      alterationDateTo: null,
      person: [],
      personrecommendationDateFrom: null,
      personrecommendationDateTo: null,
      radioValue: "all",
      places: [],
    },
    token: null,
    language: "el",
  };
}

function isIndividualLegalType(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.includes("ατομικ") || normalized.includes("individual");
}

function scoreHit(query: string, hit: SearchHit): number {
  const q = normalizedComparable(query);
  const qTokens = q.split(" ").filter(Boolean);
  const name = normalizedComparable(normalizeString(hit.name));
  const titles = (hit.title ?? []).map((item) => normalizedComparable(normalizeString(item)));
  const nameTokens = name.split(" ").filter(Boolean);

  let score = 0;

  if (name === q) score += 220;
  if (titles.includes(q)) score += 28;
  if (name.startsWith(q)) score += 130;
  if (name.includes(q)) score += 85;
  if (titles.some((title) => title.includes(q))) score += 22;

  let tokenMatches = 0;
  for (const token of qTokens) {
    if (
      nameTokens.some(
        (candidateToken) =>
          candidateToken === token ||
          candidateToken.startsWith(token) ||
          token.startsWith(candidateToken),
      )
    ) {
      tokenMatches += 1;
    }
  }

  score += tokenMatches * 24;
  if (qTokens.length > 1 && tokenMatches === qTokens.length) score += 30;

  if (normalizeString(hit.legalType).includes("ΑΕ")) score += 8;
  if (normalizeString(hit.status).includes("Ενεργ")) score += 6;
  if (isIndividualLegalType(normalizeString(hit.legalType))) score -= 120;
  if (name.includes("υποκαταστημα")) score -= 10;

  if (tokenMatches === 0 && !name.includes(q)) {
    score -= 35;
  }

  score -= Math.abs(name.length - q.length) * 0.4;

  return score;
}

function rankHits(query: string, hits: SearchHit[]): RankedHit[] {
  if (hits.length === 0) {
    return [];
  }

  const nonIndividualHits = hits.filter(
    (hit) => !isIndividualLegalType(normalizeString(hit.legalType)),
  );
  const scoredPool = nonIndividualHits.length > 0 ? nonIndividualHits : hits;

  const directDigits = query.replace(/\D+/g, "");
  if (directDigits.length >= 9) {
    const exactByGemi = scoredPool.find((hit) => normalizeString(hit.gemiNumber) === directDigits);
    if (exactByGemi) {
      return [
        { hit: exactByGemi, score: Number.MAX_SAFE_INTEGER },
        ...scoredPool
          .filter((hit) => hit !== exactByGemi)
          .map((hit) => ({ hit, score: scoreHit(query, hit) })),
      ];
    }

    const exactByVat = scoredPool.find((hit) => normalizeString(hit.afm) === directDigits);
    if (exactByVat) {
      return [
        { hit: exactByVat, score: Number.MAX_SAFE_INTEGER - 1 },
        ...scoredPool
          .filter((hit) => hit !== exactByVat)
          .map((hit) => ({ hit, score: scoreHit(query, hit) })),
      ];
    }
  }

  const scored: RankedHit[] = scoredPool.map((hit) => ({
    hit,
    score: scoreHit(query, hit),
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored;
}

function resolveCandidateHits(query: string, hits: SearchHit[]): SearchHit[] {
  return rankHits(query, hits).map((item) => item.hit);
}

function toSearchCandidate(item: RankedHit): GEMISearchCandidate {
  return {
    gemi_number: normalizeString(item.hit.gemiNumber || item.hit.id),
    name: normalizeString(item.hit.name),
    legal_form: normalizeString(item.hit.legalType),
    status: normalizeString(item.hit.status),
    city: normalizeString(item.hit.addressCity),
    score: item.score,
  };
}

function shouldRequireSelection(query: string, ranked: RankedHit[]): boolean {
  if (ranked.length <= 1) {
    return false;
  }

  const digits = query.replace(/\D+/g, "");
  if (digits.length >= 8) {
    return false;
  }

  const tokens = normalizedComparable(query).split(" ").filter(Boolean);
  if (tokens.length <= 1) {
    return true;
  }

  const top = ranked[0];
  const second = ranked[1];

  const scoreDelta = top.score - second.score;
  const relativeDelta = top.score > 0 ? second.score / top.score : 1;

  return scoreDelta < 42 || relativeDelta > 0.82;
}

export async function lookupGEMICandidates(
  query: string,
  limit = 8,
): Promise<{ requires_selection: boolean; candidates: GEMISearchCandidate[] }> {
  const trimmed = normalizeWhitespace(query);
  if (!trimmed) {
    return { requires_selection: false, candidates: [] };
  }

  const numeric = trimmed.replace(/\D+/g, "");
  if (numeric.length >= 8) {
    return {
      requires_selection: false,
      candidates: [
        {
          gemi_number: numeric,
          name: trimmed,
          legal_form: "",
          status: "",
          city: "",
          score: Number.MAX_SAFE_INTEGER,
        },
      ],
    };
  }

  const searchResponse = await postPublicityApi<{
    company?: { hits?: SearchHit[] };
  }>("/api/search", getSearchPayload(trimmed));

  const hits = searchResponse.company?.hits ?? [];
  const ranked = rankHits(trimmed, hits);
  const candidates = ranked
    .slice(0, Math.max(1, limit))
    .map(toSearchCandidate)
    .filter((candidate) => candidate.gemi_number);

  return {
    requires_selection: shouldRequireSelection(trimmed, ranked),
    candidates,
  };
}

function buildAddress(company: CompanyDetailsPayload["company"]): string {
  const parts = [
    normalizeString(company?.company_street),
    normalizeString(company?.company_street_number),
    normalizeString(company?.company_region),
    normalizeString(company?.company_municipality),
    normalizeString(company?.company_city),
    normalizeString(company?.company_zip_code),
  ].filter(Boolean);

  return parts.join(", ");
}

function deriveActivityCode(kadData: CompanyDetailsPayload["kadData"]): { code: string; description: string } {
  if (!kadData || kadData.length === 0) {
    return { code: "", description: "" };
  }

  const primary =
    kadData.find((item) => normalizeString(item.activities).toLowerCase().includes("κύρια")) ??
    kadData[0];

  return {
    code: normalizeString(primary?.kad),
    description: normalizeString(primary?.descr || primary?.objective),
  };
}

function mapDirectors(payload: CompanyDetailsPayload): RawDirector[] {
  function parseSortableDate(value: string): number {
    const source = normalizeString(value);
    if (!source) {
      return -1;
    }

    const native = Date.parse(source);
    if (!Number.isNaN(native)) {
      return native;
    }

    const match = source.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!match) {
      return -1;
    }

    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const yearRaw = Number.parseInt(match[3], 10);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const date = Date.UTC(year, month - 1, day);
    return Number.isNaN(date) ? -1 : date;
  }

  function isPlaceholderName(name: string): boolean {
    const normalized = normalizedComparable(name);
    return (
      normalized.length < 3 ||
      normalized.includes("nofirstname") ||
      normalized.includes("nolastname") ||
      normalized === "n a"
    );
  }

  function directorRank(director: RawDirector): number {
    const statusWeight =
      director.status === "active" ? 3 : director.status === "inactive" ? 1 : 0;
    const dateWeight = Math.max(parseSortableDate(director.appointed), 0);
    return statusWeight * 10_000_000_000_000 + dateWeight;
  }

  const directors: RawDirector[] = [];

  for (const person of payload.managementPersons ?? []) {
    const name = normalizeWhitespace(
      `${normalizeString(person.firstName)} ${normalizeString(person.lastName)}`,
    );

    if (!name) {
      continue;
    }
    if (isPlaceholderName(name)) {
      continue;
    }

    directors.push({
      name,
      role: normalizeString(person.capacityDescr) || normalizeString(person.tableName),
      status: person.active === 1 ? "active" : person.active === 0 ? "inactive" : "unknown",
      appointed: normalizeString(person.dateFrom || person.dateElection),
      tenure: normalizeString(person.dateFrom)
        ? `${normalizeString(person.dateFrom)}${normalizeString(person.dateTo) ? ` -> ${normalizeString(person.dateTo)}` : " -> present"}`
        : "",
      other_directorships: [],
    });
  }

  for (const rep of payload.representation ?? []) {
    const name = normalizeWhitespace(
      `${normalizeString(rep.firstName)} ${normalizeString(rep.lastName)}`,
    );

    if (!name) {
      continue;
    }
    if (isPlaceholderName(name)) {
      continue;
    }

    directors.push({
      name,
      role: normalizeString(rep.capacityDescr) || "Representative",
      status: rep.active === 1 ? "active" : rep.active === 0 ? "inactive" : "unknown",
      appointed: normalizeString(rep.dateFrom),
      tenure: normalizeString(rep.dateFrom)
        ? `${normalizeString(rep.dateFrom)}${normalizeString(rep.dateTo) ? ` -> ${normalizeString(rep.dateTo)}` : " -> present"}`
        : "",
      other_directorships: [],
    });
  }

  const dedup = new Map<string, RawDirector>();

  for (const director of directors) {
    const key = `${normalizedComparable(director.name)}|${normalizedComparable(director.role)}`;
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, director);
      continue;
    }

    if (directorRank(director) > directorRank(existing)) {
      dedup.set(key, director);
    }
  }

  const normalized = [...dedup.values()].sort((left, right) => {
    if (left.status !== right.status) {
      if (left.status === "active") return -1;
      if (right.status === "active") return 1;
    }

    const dateDelta = parseSortableDate(right.appointed) - parseSortableDate(left.appointed);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return left.name.localeCompare(right.name, "el");
  });

  return normalized.slice(0, 40);
}

function mapShareholders(payload: CompanyDetailsPayload): RawShareholder[] {
  function parsePercentage(value: unknown): number | null {
    const normalized = normalizeString(value);
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized.replace(/[^0-9.,-]/g, "").replace(/,/g, "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const dedup = new Map<string, RawShareholder>();

  for (const person of payload.managementPersons ?? []) {
    const name = normalizeWhitespace(
      `${normalizeString(person.firstName)} ${normalizeString(person.lastName)}`,
    );
    if (!name) {
      continue;
    }

    const role = `${normalizeString(person.capacityDescr)} ${normalizeString(person.tableName)}`.toLowerCase();
    const isShareholderRole =
      role.includes("εταίρ") ||
      role.includes("μέτοχ") ||
      role.includes("shareholder") ||
      role.includes("partner") ||
      role.includes("owner");

    let percentage = parsePercentage(person.percentage);

    if (percentage === null && isShareholderRole && role.includes("μοναδ")) {
      percentage = 100;
    }

    if (!isShareholderRole && percentage === null) {
      continue;
    }

    const entityType = person.isCompany === 1 ? "corporate" : "individual";
    const key = `${normalizedComparable(name)}|${entityType}`;
    const existing = dedup.get(key);
    const nextPercentage = percentage ?? 0;

    if (!existing) {
      dedup.set(key, {
        name,
        percentage: nextPercentage,
        entity_type: entityType,
      });
      continue;
    }

    if (nextPercentage > existing.percentage) {
      existing.percentage = nextPercentage;
    }
  }

  return [...dedup.values()].filter((shareholder) => shareholder.percentage > 0);
}

function mapFilings(payload: CompanyDetailsPayload, companyId: string): RawFiling[] {
  const filings: RawFiling[] = [];

  for (const filing of payload.ModificationHistoryData ?? []) {
    const id = normalizeString(filing.id || filing.kak);
    if (!id) {
      continue;
    }

    filings.push({
      date: normalizeString(filing.announcement_date || filing.registration_date),
      id,
      type: normalizeString(filing.applicationStatusDescr) || "Modification",
      description: normalizeString(filing.descr),
      download_url: `${BASE_URL}/api/download/Modifications/${id}?companyId=${companyId}`,
    });
  }

  for (const yms of payload.YmsData ?? []) {
    const id = normalizeString(yms.id || yms.ymsKak);
    if (!id) {
      continue;
    }

    filings.push({
      date: normalizeString(yms.ymsDate),
      id,
      type: "YMS Filing",
      description: normalizeString(yms.ymsDescription),
      download_url: `${BASE_URL}/api/download/YMSdata/${id}?companyId=${companyId}`,
    });
  }

  for (const decision of payload.decisions ?? []) {
    const id = normalizeString(decision.id);
    if (!id) {
      continue;
    }

    filings.push({
      date: normalizeString(decision.date_issued),
      id,
      type: "Board / Corporate Decision",
      description: normalizeString(decision.descr),
      download_url: `${BASE_URL}/api/download/decisions/${id}?companyId=${companyId}`,
    });
  }

  return filings;
}

function mapFinancials(payload: CompanyDetailsPayload, companyId: string): RawFinancial[] {
  const financials: RawFinancial[] = [];

  for (const periodBlock of payload.companyFinancial ?? []) {
    const period = normalizeString(periodBlock.referencePeriod);

    for (const fileSet of periodBlock.FilesAndAuditors ?? []) {
      const auditor = normalizeString(
        fileSet.auditors?.find((item) => normalizeString(item.companyName))?.companyName ||
          fileSet.auditors?.find((item) => normalizeString(item.auditorName))?.auditorName,
      );

      const files = fileSet.balancesheet ?? [];

      if (files.length === 0) {
        financials.push({
          period,
          auditor,
          filename: "",
          download_url: undefined,
        });
        continue;
      }

      for (const file of files) {
        const fileId = file.id ? String(file.id) : "";
        const filename = normalizeString(file.bal_file_system_file_path)
          ? basenameFromPath(normalizeString(file.bal_file_system_file_path))
          : `financial-${fileId}.pdf`;

        financials.push({
          period,
          auditor,
          filename,
          download_url: fileId
            ? `${BASE_URL}/api/download/financial/${fileId}?companyId=${companyId}`
            : undefined,
        });
      }
    }
  }

  const filtered = financials.filter(
    (entry) =>
      normalizeString(entry.period) || normalizeString(entry.filename) || normalizeString(entry.auditor),
  );

  const dedup = new Map<string, RawFinancial>();

  for (const entry of filtered) {
    const key = normalizeString(
      entry.download_url ||
        `${entry.period}|${entry.filename}|${entry.auditor || ""}`,
    );

    if (!dedup.has(key)) {
      dedup.set(key, entry);
    }
  }

  return [...dedup.values()];
}

function mapToRawData(
  query: string,
  hit: SearchHit,
  payload: CompanyDetailsPayload,
): GEMIRawData {
  const company = payload.company;

  const companyId = normalizeString(company?.id) || normalizeString(hit.gemiNumber) || "";

  const { code: activityCode, description: activityDescription } = deriveActivityCode(payload.kadData);

  const capitalEntry = payload.capital?.[0];
  const amountNumber = parseFlexibleNumber(capitalEntry?.amount);
  const sharesNumber = parseFlexibleNumber(capitalEntry?.capital_stock);
  const nominalNumber = parseFlexibleNumber(capitalEntry?.nominal_price);
  const capitalCurrency = normalizeString(capitalEntry?.currency) || "EUR";

  let totalNumber = amountNumber;
  if (sharesNumber && nominalNumber) {
    const computedTotal = sharesNumber * nominalNumber;

    if (
      !totalNumber ||
      (totalNumber > 0 &&
        Math.abs(computedTotal - totalNumber) / Math.max(computedTotal, totalNumber) > 0.02) ||
      (totalNumber > 0 && totalNumber <= sharesNumber + 1)
    ) {
      totalNumber = computedTotal;
    }
  }

  const capitalTotal = totalNumber
    ? `${formatGreekNumber(totalNumber)} ${capitalCurrency}`
    : normalizeString(capitalEntry?.amount)
      ? `${normalizeString(capitalEntry?.amount)} ${capitalCurrency}`
      : "";

  const capitalShares = sharesNumber !== null
    ? formatGreekNumber(sharesNumber, 0)
    : normalizeString(capitalEntry?.capital_stock);

  const capitalNominalValue = nominalNumber !== null
    ? formatGreekNumber(nominalNumber)
    : normalizeString(capitalEntry?.nominal_price);

  const directors = mapDirectors(payload);
  const shareholders = mapShareholders(payload);
  const filings = mapFilings(payload, companyId);
  const financials = mapFinancials(payload, companyId);

  const unsignedFinancials = financials
    .filter((financial) => /unsigned|ανυπόγραφ/i.test(financial.filename))
    .map((financial) => ({ filename: financial.filename, href: financial.download_url }));

  const notes: ReportNews[] = [];

  return {
    source: "live",
    company: {
      name: normalizeString(company?.name) || normalizeString(hit.name) || query,
      legal_form: normalizeString(company?.legalType?.desc) || normalizeString(hit.legalType),
      gemi_number: companyId,
      vat: normalizeString(company?.afm) || normalizeString(hit.afm),
      status: normalizeString(company?.companyStatus?.status) || normalizeString(hit.status),
      address: buildAddress(company) || normalizeString(hit.addressCity),
      website: normalizeString(company?.companyWebsite) || undefined,
      founded: normalizeString(company?.dateStart || company?.dateGemiRegistered),
      activity_code: activityCode,
      activity_description: activityDescription,
    },
    capital: {
      total: capitalTotal,
      shares: capitalShares,
      value: capitalNominalValue,
      last_changed: normalizeString(filings[0]?.date),
      history: [],
    },
    directors,
    shareholders,
    filings,
    financials,
    news: notes,
    flags: {
      unsigned_financials: unsignedFinancials,
      pdf_signals: [],
    },
    scraped_at: new Date().toISOString(),
  };
}

async function scrapeViaPublicityApi(query: string): Promise<GEMIRawData> {
  const trimmed = normalizeWhitespace(query);

  if (!trimmed) {
    throw new Error("Empty query");
  }

  const numeric = trimmed.replace(/\D+/g, "");

  let candidateHits: SearchHit[] = [];

  if (numeric.length >= 8) {
    candidateHits = [
      {
        gemiNumber: numeric,
        id: numeric,
        name: trimmed,
      },
    ];
  } else {
    const searchResponse = await postPublicityApi<{
      company?: { hits?: SearchHit[] };
    }>("/api/search", getSearchPayload(trimmed));

    const hits = searchResponse.company?.hits ?? [];
    candidateHits = resolveCandidateHits(trimmed, hits);
  }

  if (candidateHits.length === 0) {
    throw new Error(`No GEMI result found for query: ${query}`);
  }

  let lastError = "";
  const triedGemis: string[] = [];

  for (const hit of candidateHits.slice(0, 8)) {
    const gemi = normalizeString(hit.gemiNumber || hit.id);
    if (!gemi) {
      continue;
    }

    triedGemis.push(gemi);

    try {
      const detailsResponse = await postPublicityApi<{
        companyInfo?: { payload?: CompanyDetailsPayload; errorMessage?: string | null };
      }>("/api/company/details", {
        query: { arGEMI: gemi },
        token: null,
        language: "el",
      });

      const payload = detailsResponse.companyInfo?.payload;
      if (!payload?.company) {
        const apiMessage = normalizeString(detailsResponse.companyInfo?.errorMessage);
        lastError = apiMessage || `No company details payload for GEMI ${gemi}`;
        continue;
      }

      return mapToRawData(query, hit, payload);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    `Could not fetch company details for query: ${query}. Tried GEMIs: ${triedGemis.join(", ")}. ${lastError}`,
  );
}

export async function scrapeGEMI(query: string): Promise<GEMIRawData> {
  try {
    return await scrapeViaPublicityApi(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallbackRawData(query, message);
  }
}
