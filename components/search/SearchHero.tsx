"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  clearUserApiKeysFromStorage,
  normalizeUserApiKeys,
  readUserApiKeysFromStorage,
  saveUserApiKeysToStorage,
  type UserApiKeys,
} from "@/lib/api-keys";
import { readJsonSafe } from "@/lib/http-client";

const placeholders = ["Skroutz", "Butler Chat", "Fluoverse"];

interface SearchCandidate {
  gemi_number: string;
  name: string;
  legal_form: string;
  status: string;
  city: string;
  score: number;
}

export default function SearchHero() {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [selectedGemi, setSelectedGemi] = useState<string>("");
  const [showCandidateList, setShowCandidateList] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [apiKeys, setApiKeys] = useState<UserApiKeys>({});
  const [apiKeySaveState, setApiKeySaveState] = useState<"idle" | "saved">("idle");

  const activePlaceholder = useMemo(
    () => placeholders[placeholderIndex % placeholders.length],
    [placeholderIndex],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((current) => current + 1);
    }, 2100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setApiKeys(readUserApiKeysFromStorage());
  }, []);

  async function launchSearch(overrideGemi?: string): Promise<void> {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query.trim(),
        selected_gemi: overrideGemi || undefined,
        api_keys: normalizeUserApiKeys(apiKeys),
      }),
    });

    const payload = await readJsonSafe<{
      search_id?: string;
      error?: string;
      requires_selection?: boolean;
      candidates?: SearchCandidate[];
    }>(response);

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to launch due diligence pipeline. Please retry.");
    }

    if (payload?.requires_selection && payload.candidates && payload.candidates.length > 0) {
      setCandidates(payload.candidates);
      setSelectedGemi(payload.candidates[0].gemi_number);
      setShowCandidateList(false);
      return;
    }

    if (!payload?.search_id) {
      throw new Error("Unable to launch due diligence pipeline.");
    }

    router.push(`/search/${payload.search_id}`);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmed = query.trim();
    if (!trimmed || loading) {
      return;
    }

    if (candidates.length > 0 && selectedGemi) {
      await onConfirmSelection();
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await launchSearch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onConfirmSelection(): Promise<void> {
    if (!selectedGemi || loading) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await launchSearch(selectedGemi);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const topCandidate = candidates[0];
  const selectedCandidate =
    candidates.find((candidate) => candidate.gemi_number === selectedGemi) || topCandidate || null;
  const isTopMatchSelected =
    Boolean(selectedGemi) && Boolean(topCandidate) && selectedGemi === topCandidate?.gemi_number;
  const hasAnyApiKey = Boolean(apiKeys.geminiApiKey || apiKeys.openaiApiKey || apiKeys.serpApiKey);

  function updateApiKey(field: keyof UserApiKeys, value: string): void {
    setApiKeySaveState("idle");
    setApiKeys((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function onSaveApiKeys(): void {
    const normalized = saveUserApiKeysToStorage(apiKeys);
    setApiKeys(normalized);
    setApiKeySaveState("saved");
  }

  function onClearApiKeys(): void {
    clearUserApiKeysFromStorage();
    setApiKeys({});
    setApiKeySaveState("idle");
  }

  return (
    <main className="landing-shell">
      <div className="landing-grid" aria-hidden />
      <div className="landing-noise" aria-hidden />

      <section className="landing-content">
        <p className="eyebrow">GEMI Intelligence</p>
        <h1>
          Full due diligence in{" "}
          <span className="hero-time-highlight">60 seconds</span>.
        </h1>
        <p className="subline">Type any Greek company name.</p>

        <form className="search-form" onSubmit={onSubmit}>
          <div className="search-input-wrap">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (candidates.length > 0) {
                  setCandidates([]);
                  setSelectedGemi("");
                  setShowCandidateList(false);
                }
              }}
              placeholder={activePlaceholder}
              spellCheck={false}
              autoComplete="off"
              className="search-input"
              aria-label="Company search"
            />
            <button type="submit" className="search-button" disabled={loading || !query.trim()}>
              {loading ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
              <span>
                {loading
                  ? "Launching"
                  : candidates.length > 0
                    ? `Run due diligence for ${truncateName(selectedCandidate?.name || "")}`
                    : "Find company"}
              </span>
            </button>
          </div>
          <p className="examples">Try: Skroutz • Butler Chat • Fluoverse</p>
          <section className="api-keys-wrap">
            <div className="api-keys-head">
              <p className="api-keys-title">
                Bring your own keys for AI + news enrichment ({hasAnyApiKey ? "configured" : "not configured"}).
              </p>
              <button
                type="button"
                className="candidate-link-btn"
                onClick={() => setShowApiKeys((current) => !current)}
              >
                {showApiKeys ? "Hide key settings" : "Configure keys"}
              </button>
            </div>

            {showApiKeys ? (
              <div className="api-keys-panel">
                <label className="api-keys-field">
                  <span>Gemini API key (optional)</span>
                  <input
                    type="password"
                    value={apiKeys.geminiApiKey ?? ""}
                    onChange={(event) => updateApiKey("geminiApiKey", event.target.value)}
                    placeholder="AIza..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <label className="api-keys-field">
                  <span>OpenAI API key (optional)</span>
                  <input
                    type="password"
                    value={apiKeys.openaiApiKey ?? ""}
                    onChange={(event) => updateApiKey("openaiApiKey", event.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <label className="api-keys-field">
                  <span>SerpAPI key for live news (optional)</span>
                  <input
                    type="password"
                    value={apiKeys.serpApiKey ?? ""}
                    onChange={(event) => updateApiKey("serpApiKey", event.target.value)}
                    placeholder="..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <div className="api-keys-actions">
                  <button type="button" className="inline-action" onClick={onSaveApiKeys}>
                    {apiKeySaveState === "saved" ? "Saved" : "Save keys locally"}
                  </button>
                  <button type="button" className="inline-action" onClick={onClearApiKeys}>
                    Clear keys
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          {error ? <p className="error-text">{error}</p> : null}

          {candidates.length > 0 ? (
            <section className="candidate-panel">
              <p className="candidate-title">Multiple matching entities found. Top match is preselected.</p>

              {selectedCandidate ? (
                <article className="candidate-selected">
                  <div className="candidate-selected-head">
                    <em className="top-match-badge">{isTopMatchSelected ? "Top match" : "Selected"}</em>
                    {!isTopMatchSelected ? <span className="candidate-selected-note">Manual selection</span> : null}
                  </div>
                  <strong>{selectedCandidate.name}</strong>
                  <small>
                    GEMI {selectedCandidate.gemi_number} · {selectedCandidate.legal_form || "Unknown legal form"} ·{" "}
                    {selectedCandidate.status || "Unknown"}{" "}
                    {selectedCandidate.city ? `· ${selectedCandidate.city}` : ""}
                  </small>
                </article>
              ) : null}

              <button
                type="button"
                className="candidate-link-btn"
                onClick={() => setShowCandidateList((current) => !current)}
              >
                {showCandidateList ? "Hide alternatives" : "Not this company? Change selection"}
              </button>

              {showCandidateList ? (
                <ul className="candidate-list">
                  {candidates.map((candidate) => (
                    <li
                      key={candidate.gemi_number}
                      className={selectedGemi === candidate.gemi_number ? "selected" : ""}
                    >
                      <label>
                        <input
                          type="radio"
                          name="candidate"
                          checked={selectedGemi === candidate.gemi_number}
                          onChange={() => {
                            setSelectedGemi(candidate.gemi_number);
                            setShowCandidateList(false);
                          }}
                        />
                        <span>
                          <strong>
                            {candidate.name}
                            {candidate.gemi_number === candidates[0]?.gemi_number ? (
                              <em className="top-match-badge">Top match</em>
                            ) : null}
                          </strong>
                          <small>
                            GEMI {candidate.gemi_number} · {candidate.legal_form || "Unknown legal form"} ·{" "}
                            {candidate.status || "Unknown"} {candidate.city ? `· ${candidate.city}` : ""}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function truncateName(value: string, max = 34): string {
  const normalized = value.trim();
  if (!normalized) {
    return "selected company";
  }

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 1)}…`;
}
