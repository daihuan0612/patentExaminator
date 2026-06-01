/**
 * Unit tests for client/src/lib/knowledge/* modules.
 *
 * Covers:
 * - retriever: formatRetrievedChunks
 * - promptInjector: buildKnowledgeContext
 *
 * Test strategy: pure function tests, no IndexedDB or network calls.
 *
 * Note: chunkers tests removed — chunkers.ts deleted in B-021, chunking moved to server.
 * Note: embedder/vectorStore/bm25Search/hybridSearch tests removed — files deleted in bg-72 (dead code cleanup).
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────
// retriever tests
// ──────────────────────────────────────────────────

describe("retriever", () => {
  describe("formatRetrievedChunks", () => {
    it("formats empty results", async () => {
      const { formatRetrievedChunks } = await import("@client/lib/knowledge/retriever");
      const result = formatRetrievedChunks([]);
      expect(result).toBe("");
    });

    it("formats single chunk", async () => {
      const { formatRetrievedChunks } = await import("@client/lib/knowledge/retriever");
      const chunks = [{
        chunk: { id: "c1", sourceId: "s1", index: 0, text: "test text", strategy: "heading" as const, metadata: { fileName: "test.md", mediaType: "text" as const }, embedded: true, createdAt: new Date().toISOString() },
        score: 0.95,
        sourceName: "test.md"
      }];
      const result = formatRetrievedChunks(chunks);
      expect(result).toContain("test text");
      expect(result).toContain("0.95");
    });
  });
});

// ──────────────────────────────────────────────────
// promptInjector tests
// ──────────────────────────────────────────────────

describe("promptInjector", () => {
  describe("extractQueryFromRequest", () => {
    it("is a function", async () => {
      const { extractQueryFromRequest } = await import("@client/lib/knowledge/promptInjector");
      expect(typeof extractQueryFromRequest).toBe("function");
    });
  });
});
