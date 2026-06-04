/**
 * knowledgeDb.test.ts — 知识库 SQLite 数据层测试
 * ================================================
 * Tests: sources/chunks/vectors CRUD, text hash, stats, clearAll
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

// Set temp DB path before module loads
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-test-"));
process.env.KNOWLEDGE_DB_DIR = tmpDir;
process.env.KNOWLEDGE_DB_PATH = path.join(tmpDir, "test.db");

vi.mock("@server/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
  addSource, getAllSources, deleteSource,
  addChunks, getAllChunks, getUnembeddedChunks, markChunkEmbedded,
  addVectors, getAllVectors,
  getStats, clearAll, findDuplicateByHash, computeTextHash, findChunksByHashes
} from "@server/lib/knowledgeDb.js";

// ── Sources ─────────────────────────────────────────────────

describe("knowledgeDb — Sources", () => {
  beforeEach(() => {
    clearAll();
  });

  const testSource = {
    id: "src-1",
    name: "test.pdf",
    type: "file",
    format: "pdf",
    mediaType: "application/pdf",
    size: 1024,
    chunkCount: 5,
    embedStatus: "pending"
  };

  it("addSource + getAllSources round-trip", () => {
    addSource(testSource);
    const sources = getAllSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("src-1");
    expect(sources[0].name).toBe("test.pdf");
    expect(sources[0].mediaType).toBe("application/pdf");
  });

  it("addSource with optional fields", () => {
    addSource({ ...testSource, fileHash: "abc123", sourceUrl: "https://example.com" });
    const sources = getAllSources();
    expect(sources[0].fileHash).toBe("abc123");
    expect(sources[0].sourceUrl).toBe("https://example.com");
  });

  it("addSource replaces on duplicate id (INSERT OR REPLACE)", () => {
    addSource(testSource);
    addSource({ ...testSource, name: "updated.pdf" });
    const sources = getAllSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("updated.pdf");
  });

  it("deleteSource removes source and its chunks", () => {
    addSource(testSource);
    addChunks([{ id: "c1", sourceId: "src-1", index: 0, text: "chunk", strategy: "auto", metadata: {} }]);
    deleteSource("src-1");
    expect(getAllSources()).toHaveLength(0);
    expect(getAllChunks()).toHaveLength(0);
  });

  it("findDuplicateByHash returns matching source", () => {
    addSource({ ...testSource, fileHash: "hash-abc" });
    expect(findDuplicateByHash("hash-abc")?.id).toBe("src-1");
    expect(findDuplicateByHash("hash-xyz")).toBeUndefined();
  });
});

// ── Chunks ──────────────────────────────────────────────────

describe("knowledgeDb — Chunks", () => {
  beforeEach(() => {
    clearAll();
    addSource({ id: "src-1", name: "test.pdf", type: "file", format: "pdf", mediaType: "application/pdf", size: 100, chunkCount: 3, embedStatus: "pending" });
  });

  const testChunks = [
    { id: "c1", sourceId: "src-1", index: 0, text: "First chunk text", strategy: "auto", metadata: { page: 1 } },
    { id: "c2", sourceId: "src-1", index: 1, text: "Second chunk text", strategy: "auto", metadata: { page: 2 } },
    { id: "c3", sourceId: "src-1", index: 2, text: "Third chunk text", strategy: "auto", metadata: { page: 3 } },
  ];

  it("addChunks + getAllChunks round-trip", () => {
    addChunks(testChunks);
    const chunks = getAllChunks();
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toBe("First chunk text");
  });

  it("getUnembeddedChunks returns only unembedded", () => {
    addChunks(testChunks);
    markChunkEmbedded("c1");
    const unembedded = getUnembeddedChunks();
    expect(unembedded).toHaveLength(2);
    expect(unembedded.map(c => c.id)).not.toContain("c1");
  });

  it("markChunkEmbedded updates embedded flag", () => {
    addChunks([testChunks[0]]);
    markChunkEmbedded("c1");
    const unembedded = getUnembeddedChunks();
    expect(unembedded).toHaveLength(0);
  });
});

// ── Vectors ─────────────────────────────────────────────────

describe("knowledgeDb — Vectors", () => {
  beforeEach(() => {
    clearAll();
    addSource({ id: "src-1", name: "test.pdf", type: "file", format: "pdf", mediaType: "application/pdf", size: 100, chunkCount: 1, embedStatus: "pending" });
    addChunks([{ id: "c1", sourceId: "src-1", index: 0, text: "chunk", strategy: "auto", metadata: {} }]);
  });

  it("addVectors + getAllVectors round-trip", () => {
    addVectors([{ chunkId: "c1", vector: [0.1, 0.2, 0.3], modelId: "test-model" }]);
    const vectors = getAllVectors();
    expect(vectors).toHaveLength(1);
    expect(vectors[0].chunkId).toBe("c1");
    expect(vectors[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(vectors[0].modelId).toBe("test-model");
  });

  it("addVectors replaces on duplicate chunkId", () => {
    addVectors([{ chunkId: "c1", vector: [0.1], modelId: "m1" }]);
    addVectors([{ chunkId: "c1", vector: [0.9], modelId: "m2" }]);
    const vectors = getAllVectors();
    expect(vectors).toHaveLength(1);
    expect(vectors[0].vector).toEqual([0.9]);
  });
});

// ── Stats & Clear ───────────────────────────────────────────

describe("knowledgeDb — Stats & Clear", () => {
  beforeEach(() => {
    clearAll();
  });

  it("getStats returns zero counts for empty db", () => {
    const stats = getStats();
    expect(stats).toEqual({ sourceCount: 0, chunkCount: 0, embeddedCount: 0 });
  });

  it("getStats counts correctly after inserts", () => {
    addSource({ id: "s1", name: "a.pdf", type: "file", format: "pdf", mediaType: "application/pdf", size: 100, chunkCount: 2, embedStatus: "done" });
    addChunks([
      { id: "c1", sourceId: "s1", index: 0, text: "a", strategy: "auto", metadata: {} },
      { id: "c2", sourceId: "s1", index: 1, text: "b", strategy: "auto", metadata: {} }
    ]);
    markChunkEmbedded("c1");
    const stats = getStats();
    expect(stats.sourceCount).toBe(1);
    expect(stats.chunkCount).toBe(2);
    expect(stats.embeddedCount).toBe(1);
  });

  it("clearAll removes everything", () => {
    addSource({ id: "s1", name: "a.pdf", type: "file", format: "pdf", mediaType: "application/pdf", size: 100, chunkCount: 1, embedStatus: "done" });
    addChunks([{ id: "c1", sourceId: "s1", index: 0, text: "a", strategy: "auto", metadata: {} }]);
    addVectors([{ chunkId: "c1", vector: [1], modelId: "m" }]);
    clearAll();
    const stats = getStats();
    expect(stats).toEqual({ sourceCount: 0, chunkCount: 0, embeddedCount: 0 });
  });
});

// ── Text Hash ───────────────────────────────────────────────

describe("knowledgeDb — Text Hash", () => {
  it("computeTextHash returns consistent MD5", () => {
    const hash1 = computeTextHash("hello world");
    const hash2 = computeTextHash("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("different texts produce different hashes", () => {
    expect(computeTextHash("abc")).not.toBe(computeTextHash("def"));
  });

  it("findChunksByHashes returns matching chunks with vectors", () => {
    clearAll();
    addSource({ id: "s1", name: "a.pdf", type: "file", format: "pdf", mediaType: "application/pdf", size: 100, chunkCount: 1, embedStatus: "done" });
    addChunks([{ id: "c1", sourceId: "s1", index: 0, text: "test text", strategy: "auto", metadata: {} }]);
    markChunkEmbedded("c1");
    addVectors([{ chunkId: "c1", vector: [0.1, 0.2], modelId: "m" }]);

    const hash = computeTextHash("test text");
    const result = findChunksByHashes([hash]);
    expect(result.has(hash)).toBe(true);
    expect(result.get(hash)?.chunkId).toBe("c1");
    expect(result.get(hash)?.vector).toEqual([0.1, 0.2]);
  });

  it("findChunksByHashes returns empty for unknown hashes", () => {
    clearAll();
    const result = findChunksByHashes(["nonexistent"]);
    expect(result.size).toBe(0);
  });

  it("findChunksByHashes handles empty input", () => {
    const result = findChunksByHashes([]);
    expect(result.size).toBe(0);
  });
});

// Cleanup
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
