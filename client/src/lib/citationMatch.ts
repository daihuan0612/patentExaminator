import type { Citation, TextIndex } from "@shared/types/domain";

export interface MatchResult {
  status: "found" | "not-found";
  confidence: "high" | "medium" | "low";
  matchedParagraphId?: string | undefined;
  matchedOffset?: { start: number; end: number } | undefined;
}

/**
 * Four-level citation matching against a TextIndex.
 * MIGRATE-010: 调用后端 API 进行引用匹配
 */
export async function matchCitation(citation: Citation, index: TextIndex): Promise<MatchResult> {
  const res = await fetch("/api/documents/match-citation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ citation, textIndex: index }),
  });

  if (!res.ok) {
    throw new Error(`Match citation failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { ok: boolean } & MatchResult;
  return {
    status: data.status,
    confidence: data.confidence,
    matchedParagraphId: data.matchedParagraphId,
    matchedOffset: data.matchedOffset,
  };
}
