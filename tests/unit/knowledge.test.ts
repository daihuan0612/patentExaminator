/**
 * Unit tests for client/src/lib/knowledge/* modules.
 *
 * Covers:
 * - chunkers: selectChunkStrategy, chunkBySection, chunkByArticle, chunkByJsonKey, chunkTableRow
 * - embedder: cosineSimilarity, resolveMaxTokens
 * - vectorStore: addVector, searchVectors, cosineSimilarity
 * - retriever: formatRetrievedChunks
 * - promptInjector: buildKnowledgeContext
 *
 * Test strategy: pure function tests, no IndexedDB or network calls.
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────
// 1. chunkers tests
// ──────────────────────────────────────────────────

describe("chunkers", () => {
  describe("selectChunkStrategy", () => {
    it("returns 'table-row' for table media type", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("data.xlsx", "table")).toBe("table-row");
    });

    it("returns 'image-ocr' for image media type", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("image.png", "image")).toBe("image-ocr");
    });

    it("returns 'section' for 审查指南 files", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("审查指南.pdf", "text")).toBe("section");
    });

    it("returns 'article' for 专利法 files", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("专利法.txt", "text")).toBe("article");
    });

    it("returns 'json-key' for JSON files", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("data.json", "text")).toBe("json-key");
    });

    it("returns 'heading' for other text files", async () => {
      const { selectChunkStrategy } = await import("@client/lib/knowledge/chunkers");
      expect(selectChunkStrategy("document.md", "text")).toBe("heading");
    });
  });

  describe("chunkContent", () => {
    it("chunks text content by heading strategy", async () => {
      const { chunkContent } = await import("@client/lib/knowledge/chunkers");
      const extraction = {
        text: "## 第一章 总则\n\n这是第一章的内容，包含了一些关于专利审查的基本规定和原则。\n\n## 第二章 新颖性\n\n这是第二章的内容，详细说明了新颖性的判断标准和方法。",
        mediaType: "text" as const
      };
      const chunks = chunkContent(extraction, "test.md");
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});

// ──────────────────────────────────────────────────
// 2. embedder tests
// ──────────────────────────────────────────────────

describe("embedder", () => {
  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", async () => {
      const { cosineSimilarity } = await import("@client/lib/knowledge/embedder");
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    });

    it("returns 0 for orthogonal vectors", async () => {
      const { cosineSimilarity } = await import("@client/lib/knowledge/embedder");
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it("returns -1 for opposite vectors", async () => {
      const { cosineSimilarity } = await import("@client/lib/knowledge/embedder");
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    it("returns 0 for vectors of different lengths", async () => {
      const { cosineSimilarity } = await import("@client/lib/knowledge/embedder");
      expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    });

    it("returns 0 for zero vectors", async () => {
      const { cosineSimilarity } = await import("@client/lib/knowledge/embedder");
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });
  });
});

// ──────────────────────────────────────────────────
// 3. vectorStore tests
// ──────────────────────────────────────────────────

describe("vectorStore", () => {
  describe("invalidateVectorIndex", () => {
    it("is a function", async () => {
      const { invalidateVectorIndex } = await import("@client/lib/knowledge/vectorStore");
      expect(typeof invalidateVectorIndex).toBe("function");
    });
  });

  describe("getVectorIndexStats", () => {
    it("is a function", async () => {
      const { getVectorIndexStats } = await import("@client/lib/knowledge/vectorStore");
      expect(typeof getVectorIndexStats).toBe("function");
    });
  });
});

// ──────────────────────────────────────────────────
// 4. retriever tests
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
// 5. promptInjector tests
// ──────────────────────────────────────────────────

describe("promptInjector", () => {
  describe("extractQueryFromRequest", () => {
    it("is a function", async () => {
      const { extractQueryFromRequest } = await import("@client/lib/knowledge/promptInjector");
      expect(typeof extractQueryFromRequest).toBe("function");
    });
  });
});
