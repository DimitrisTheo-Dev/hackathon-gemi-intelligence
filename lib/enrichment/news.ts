import { env } from "@/lib/env";
import type { ReportNews } from "@/lib/types";
import { sleep } from "@/lib/utils";

export async function fetchRecentNews(companyName: string): Promise<ReportNews[]> {
  if (!env.serpApiKey) {
    await sleep(180);
    return [];
  }

  const params = new URLSearchParams({
    engine: "google_news",
    q: `${companyName} site:gr`,
    gl: "gr",
    hl: "el",
    api_key: env.serpApiKey,
  });

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      news_results?: Array<{ title?: string; source?: { name?: string }; date?: string; snippet?: string }>;
    };

    const news: ReportNews[] = (data.news_results ?? []).slice(0, 8).map((item) => {
      const text = `${item.title ?? ""} ${item.snippet ?? ""}`.toLowerCase();
      const sentiment: ReportNews["sentiment"] = /(lawsuit|fraud|probe|fine|sanction|scandal|ποιν|δικασ)/.test(
        text,
      )
        ? "negative"
        : /(growth|record|profit|award|expansion|κερδ|αυξησ)/.test(text)
          ? "positive"
          : "neutral";

      return {
        headline: item.title ?? "Untitled",
        date: item.date ?? new Date().toISOString().slice(0, 10),
        source: item.source?.name ?? "Unknown",
        sentiment,
      };
    });

    return news;
  } catch {
    return [];
  }
}
