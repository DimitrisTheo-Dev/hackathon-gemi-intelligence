export interface UserApiKeys {
  openaiApiKey?: string;
  geminiApiKey?: string;
  serpApiKey?: string;
}

const STORAGE_KEY = "gemi-user-api-keys-v1";

function readString(
  source: Record<string, unknown>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const value = source[alias];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function normalizeUserApiKeys(input: unknown): UserApiKeys {
  if (!input || typeof input !== "object") {
    return {};
  }

  const source = input as Record<string, unknown>;
  return {
    openaiApiKey: readString(source, ["openaiApiKey", "openAiApiKey", "openai_api_key"]),
    geminiApiKey: readString(source, ["geminiApiKey", "gemini_api_key", "googleApiKey"]),
    serpApiKey: readString(source, ["serpApiKey", "serp_api_key"]),
  };
}

export function hasUserAiKey(keys: UserApiKeys): boolean {
  return Boolean(keys.geminiApiKey || keys.openaiApiKey);
}

export function hasUserNewsKey(keys: UserApiKeys): boolean {
  return Boolean(keys.serpApiKey);
}

export function readUserApiKeysFromStorage(): UserApiKeys {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeUserApiKeys(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveUserApiKeysToStorage(keys: UserApiKeys): UserApiKeys {
  const normalized = normalizeUserApiKeys(keys);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function clearUserApiKeysFromStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
