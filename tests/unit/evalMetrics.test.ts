/**
 * Unit tests for evalMetrics.ts — nf5 离线评估指标计算
 */
import { describe, it, expect } from "vitest";
import {
  computeNDCGChunkLevel,
  computeRecallChunkLevel,
  computeKBHitRate,
  computeWebHitRate,
  computeArticleAccuracy,
  computeSourceRoutingAccuracy,
  computeSourceAttributionAccuracy,
  computeConflictResolution,
  computeRefusalAccuracy,
} from "../../server/src/lib/evalMetrics.js";
import type { RelevanceGrade, SourceType, ExpectedSource } from "../../shared/src/types/metrics.js";

// ── NDCG Chunk Level ──

describe("computeNDCGChunkLevel", () => {
  it("returns 1 for empty grading", () => {
    expect(computeNDCGChunkLevel([], [])).toBe(1);
  });

  it("returns 1 for perfect ordering", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "kb", docId: "doc-b", chunkId: "c2", grade: 2, rationale: "" },
    ];
    const chunks = [{ id: "c1" }, { id: "c2" }];
    expect(computeNDCGChunkLevel(chunks, grading, 2)).toBeCloseTo(1, 2);
  });

  it("returns lower NDCG for suboptimal ordering", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "kb", docId: "doc-b", chunkId: "c2", grade: 2, rationale: "" },
    ];
    // Reversed order: lower grade first
    const chunks = [{ id: "c2" }, { id: "c1" }];
    const ndcg = computeNDCGChunkLevel(chunks, grading, 2);
    expect(ndcg).toBeLessThan(1);
    expect(ndcg).toBeGreaterThan(0);
  });

  it("returns 0 when no chunks match grading", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
    ];
    const chunks = [{ id: "unrelated" }];
    expect(computeNDCGChunkLevel(chunks, grading, 5)).toBe(0);
  });
});

// ── Recall Chunk Level ──

describe("computeRecallChunkLevel", () => {
  it("returns 1 for empty grading", () => {
    expect(computeRecallChunkLevel([], [])).toBe(1);
  });

  it("returns 1 when all relevant chunks are retrieved", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "kb", docId: "doc-b", chunkId: "c2", grade: 2, rationale: "" },
      { source: "kb", docId: "doc-c", chunkId: "c3", grade: 1, rationale: "" }, // below threshold
    ];
    const chunks = [{ id: "c1" }, { id: "c2" }];
    expect(computeRecallChunkLevel(chunks, grading, 10, 2)).toBeCloseTo(1, 2);
  });

  it("returns partial recall when some chunks are missing", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "kb", docId: "doc-b", chunkId: "c2", grade: 2, rationale: "" },
    ];
    const chunks = [{ id: "c1" }]; // missing c2
    expect(computeRecallChunkLevel(chunks, grading, 10, 2)).toBeCloseTo(0.5, 2);
  });
});

// ── KB/Web Hit Rate ──

describe("computeKBHitRate", () => {
  it("returns 1 when no KB grading exists", () => {
    const grading: RelevanceGrade[] = [
      { source: "web", docId: "url1", grade: 3, rationale: "" },
    ];
    expect(computeKBHitRate([], grading)).toBe(1);
  });

  it("computes recall only for KB sources", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "web", docId: "url1", grade: 3, rationale: "" },
    ];
    const chunks = [{ id: "c1" }];
    expect(computeKBHitRate(chunks, grading, 10)).toBeCloseTo(1, 2);
  });
});

describe("computeWebHitRate", () => {
  it("computes recall only for Web sources", () => {
    const grading: RelevanceGrade[] = [
      { source: "kb", docId: "doc-a", chunkId: "c1", grade: 3, rationale: "" },
      { source: "web", docId: "url1", grade: 3, rationale: "" },
    ];
    const chunks = [{ id: "url1" }];
    expect(computeWebHitRate(chunks, grading, 10)).toBeCloseTo(1, 2);
  });
});

// ── Article Accuracy ──

describe("computeArticleAccuracy", () => {
  it("returns 1 for empty expected articles", () => {
    expect(computeArticleAccuracy("some answer", [])).toBe(1);
  });

  it("returns 1 when all articles are cited", () => {
    const answer = "根据《专利法》第九条和《专利法实施细则》第十一条的规定...";
    const articles = ["第九条", "第十一条"];
    expect(computeArticleAccuracy(answer, articles)).toBeCloseTo(1, 2);
  });

  it("returns partial when some articles are missing", () => {
    const answer = "根据《专利法》第九条的规定...";
    const articles = ["第九条", "第十一条"];
    expect(computeArticleAccuracy(answer, articles)).toBeCloseTo(0.5, 2);
  });

  it("returns 0 when no articles are cited", () => {
    const answer = "这是一项关于专利的分析";
    const articles = ["第九条"];
    expect(computeArticleAccuracy(answer, articles)).toBe(0);
  });
});

// ── Source Routing Accuracy ──

describe("computeSourceRoutingAccuracy", () => {
  it("returns 1 for kb expected + kb actual", () => {
    expect(computeSourceRoutingAccuracy("kb", { kb: true, web: false })).toBe(1);
  });

  it("returns 0 for kb expected + web only actual", () => {
    expect(computeSourceRoutingAccuracy("kb", { kb: false, web: true })).toBe(0);
  });

  it("returns 1 for kb+web expected + both actual", () => {
    expect(computeSourceRoutingAccuracy("kb+web", { kb: true, web: true })).toBe(1);
  });

  it("returns 0.5 for kb+web expected + only one actual", () => {
    expect(computeSourceRoutingAccuracy("kb+web", { kb: true, web: false })).toBe(0.5);
  });

  it("returns 1 for any expected", () => {
    expect(computeSourceRoutingAccuracy("any", { kb: false, web: false })).toBe(1);
  });
});

// ── Source Attribution Accuracy ──

describe("computeSourceAttributionAccuracy", () => {
  it("returns 1 for empty cited sources", () => {
    expect(computeSourceAttributionAccuracy([], ["source1"])).toBe(1);
  });

  it("returns 1 when all cited sources are used", () => {
    expect(computeSourceAttributionAccuracy(["doc-a"], ["doc-a", "doc-b"])).toBeCloseTo(1, 2);
  });

  it("returns 0 when cited source is not used", () => {
    expect(computeSourceAttributionAccuracy(["doc-c"], ["doc-a", "doc-b"])).toBe(0);
  });
});

// ── Conflict Resolution ──

describe("computeConflictResolution", () => {
  it("returns 1 for non-conflict questions", () => {
    expect(computeConflictResolution("kb_only", "kb", "kb")).toBe(1);
    expect(computeConflictResolution("web_only", "web", "web")).toBe(1);
  });

  it("returns 1 when conflict question correctly chooses KB", () => {
    expect(computeConflictResolution("conflict", "kb", "kb")).toBe(1);
  });

  it("returns 0 when conflict question chooses web instead of KB", () => {
    expect(computeConflictResolution("conflict", "kb", "web")).toBe(0);
  });
});

// ── Refusal Accuracy ──

describe("computeRefusalAccuracy", () => {
  it("returns 1 for non-no_answer questions", () => {
    expect(computeRefusalAccuracy("kb_only", "some answer")).toBe(1);
  });

  it("returns 1 when no_answer question correctly refuses", () => {
    expect(computeRefusalAccuracy("no_answer", "根据现有信息，无法确定该问题的答案")).toBe(1);
  });

  it("returns 0 when no_answer question gives a confident answer", () => {
    expect(computeRefusalAccuracy("no_answer", "根据专利法第九条的规定，答案是...")).toBe(0);
  });
});
