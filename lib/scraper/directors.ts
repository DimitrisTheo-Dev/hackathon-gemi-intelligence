import type { RawDirector } from "@/lib/types";
import { sleep } from "@/lib/utils";

export async function enrichDirectors(directors: RawDirector[]): Promise<RawDirector[]> {
  if (directors.length === 0) {
    return directors;
  }

  // Keep enrichment lightweight for the hackathon runtime window.
  await sleep(250);

  return directors.map((director) => {
    const dissolvedCount = director.other_directorships.filter(
      (role) => role.status === "dissolved",
    ).length;

    return {
      ...director,
      other_directorships: director.other_directorships,
      status: director.status || "active",
      tenure: director.tenure || "n/a",
      appointed: director.appointed || "n/a",
      role: director.role || "Board Member",
      ...(dissolvedCount >= 2
        ? {
            other_directorships: director.other_directorships,
          }
        : {}),
    };
  });
}
