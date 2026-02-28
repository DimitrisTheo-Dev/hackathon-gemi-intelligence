export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function toNumber(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const normalized = value
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseYear(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

export function mapCompanyStatus(value: string | null | undefined):
  | "active"
  | "dissolved"
  | "suspended"
  | "unknown" {
  const source = (value ?? "").toLowerCase();

  if (/(ενεργ|active|ισχυ)/.test(source)) {
    return "active";
  }

  if (/(διαλυ|dissolv|terminated|εκκαθ)/.test(source)) {
    return "dissolved";
  }

  if (/(αναστο|suspend|inactive)/.test(source)) {
    return "suspended";
  }

  return "unknown";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function makeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
