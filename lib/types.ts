export type CompanyStatus = "active" | "dissolved" | "suspended" | "unknown";

export type SearchStatus = "pending" | "scraping" | "analyzing" | "complete" | "failed";

export type PipelineStage =
  | "searching_gemi"
  | "extracting"
  | "directors"
  | "filings"
  | "news"
  | "ai_analysis"
  | "complete"
  | "error";

export interface DirectorRole {
  company: string;
  gemi_number: string;
  role: string;
  status: CompanyStatus;
}

export interface ReportDirector {
  name: string;
  role: string;
  appointed: string;
  tenure: string;
  status: string;
  other_directorships: DirectorRole[];
  flag?: string;
}

export interface ReportShareholder {
  name: string;
  percentage: number;
  entity_type: "individual" | "corporate" | "unknown";
  jurisdiction?: string;
}

export interface ReportFiling {
  id?: string;
  type: string;
  date: string;
  description: string;
  download_url?: string;
  gap_flag?: boolean;
}

export interface ReportNews {
  headline: string;
  date: string;
  source: string;
  sentiment: "neutral" | "negative" | "positive";
}

export type RiskConfidence = "low" | "medium" | "high";

export interface RiskEvidenceSource {
  label: string;
  date?: string;
  reference?: string;
  snippet?: string;
  url?: string;
}

export interface RiskEvidenceFlag {
  id: string;
  label: string;
  severity: "info" | "warning" | "critical";
  score_impact?: number;
  evidence: RiskEvidenceSource[];
}

export interface RiskScoreFactor {
  id: string;
  label: string;
  impact: number;
  source_flag_id?: string;
}

export interface SourceQuality {
  filings_parsed: number;
  financial_records: number;
  pdfs_scanned: number;
  evidence_points: number;
  updated_at: string;
}

export interface FinancialPdfSignal {
  period: string;
  filename: string;
  download_url?: string;
  unsigned: boolean;
  auditor_opinion: boolean;
  qualified_opinion: boolean;
  signature_marker: boolean;
  excerpt?: string;
}

export interface GEMISearchCandidate {
  gemi_number: string;
  name: string;
  legal_form: string;
  status: string;
  city: string;
  score: number;
}

export interface GEMIReport {
  company: {
    name: string;
    legal_form: string;
    gemi_number: string;
    vat: string;
    status: CompanyStatus;
    address: string;
    website?: string;
    activity_code: string;
    activity_description: string;
    founded: string;
    dissolved?: string;
  };
  capital: {
    current_amount: number;
    currency: string;
    raw_total: string;
    last_changed: string;
    history: Array<{ date: string; amount: number; change: string }>;
  };
  directors: ReportDirector[];
  shareholders: ReportShareholder[];
  filings: ReportFiling[];
  financials: Array<{
    period: string;
    auditor: string;
    filename: string;
    download_url?: string;
  }>;
  news: ReportNews[];
  risk: {
    score: number;
    confidence: RiskConfidence;
    confidence_reason?: string;
    base_score?: number;
    score_factors?: RiskScoreFactor[];
    flags: string[];
    evidence_flags: RiskEvidenceFlag[];
    summary: string;
  };
  source_quality?: SourceQuality;
  ai_narrative: string;
  generated_at: string;
  data_source: "live" | "demo-fallback";
}

export interface RawDirector {
  name: string;
  role: string;
  status: string;
  appointed: string;
  tenure: string;
  other_directorships: DirectorRole[];
}

export interface RawShareholder {
  name: string;
  percentage: number;
  entity_type: "individual" | "corporate" | "unknown";
  jurisdiction?: string;
}

export interface RawFiling {
  date: string;
  id: string;
  type: string;
  description: string;
  download_url?: string;
}

export interface RawFinancial {
  period: string;
  auditor: string;
  filename: string;
  download_url?: string;
}

export interface GEMIRawData {
  source: "live" | "demo-fallback";
  fallback_reason?: string;
  company: {
    name: string;
    legal_form: string;
    gemi_number: string;
    vat: string;
    status: string;
    address: string;
    website?: string;
    founded: string;
    activity_code: string;
    activity_description: string;
  };
  capital: {
    total: string;
    shares: string;
    value: string;
    last_changed: string;
    history: Array<{ date: string; amount: number; change: string }>;
  };
  directors: RawDirector[];
  shareholders: RawShareholder[];
  filings: RawFiling[];
  financials: RawFinancial[];
  news: ReportNews[];
  flags: {
    unsigned_financials: Array<{ filename: string; href?: string }>;
    pdf_signals: FinancialPdfSignal[];
  };
  scraped_at: string;
}

export interface SearchEvent {
  stage: PipelineStage;
  message: string;
  progress: number;
  timestamp: string;
  report_id?: string;
}

export interface SearchRecord {
  id: string;
  query: string;
  gemi_number?: string;
  company_name?: string;
  status: SearchStatus;
  current_stage: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  report_id?: string;
}

export interface ReportRecord {
  id: string;
  search_id: string;
  gemi_number: string;
  company_name: string;
  report: GEMIReport;
  risk_score: number;
  flags: string[];
  share_token: string;
  created_at: string;
}
