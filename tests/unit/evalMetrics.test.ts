/**
 * Unit tests for evalMetrics.ts — nf5 离线评估指标计算
 *
 * 注意：M1-M3 检索指标已改为 LLM judge 实时评估（computeRetrievalMetricsRealtime），
 * 旧的 computeNDCGChunkLevel/computeRecallChunkLevel/computeKBHitRate 已删除。
 */
import { describe, it, expect } from "vitest";
import {
  computeArticleAccuracy,
  computeSourceRoutingAccuracy,
  computeRefusalAccuracy,
} from "../../server/src/lib/evalMetrics.js";

// ── Article Accuracy ──

describe("computeArticleAccuracy", () => {
  it("returns 1 when all expected articles are mentioned", () => {
    const answer = "根据专利法第二十二条和第二十六条的规定...";
    const expected = ["第二十二条", "第二十六条"];
    expect(computeArticleAccuracy(answer, expected)).toBe(1);
  });

  it("returns 0 when no expected articles are mentioned", () => {
    const answer = "根据相关规定...";
    const expected = ["第二十二条", "第二十六条"];
    expect(computeArticleAccuracy(answer, expected)).toBe(0);
  });

  it("returns 0.5 when half of expected articles are mentioned", () => {
    const answer = "根据专利法第二十二条的规定...";
    const expected = ["第二十二条", "第二十六条"];
    expect(computeArticleAccuracy(answer, expected)).toBeCloseTo(0.5, 2);
  });

  it("returns 1 for empty expected articles", () => {
    expect(computeArticleAccuracy("any answer", [])).toBe(1);
  });
});

// ── Source Routing Accuracy ──

describe("computeSourceRoutingAccuracy", () => {
  it("returns 1 when KB source matches expected", () => {
    expect(computeSourceRoutingAccuracy("kb", { kb: true, web: false })).toBe(1);
  });

  it("returns 0 when source does not match expected", () => {
    expect(computeSourceRoutingAccuracy("kb", { kb: false, web: true })).toBe(0);
  });

  it("returns 1 for 'any' expected source", () => {
    expect(computeSourceRoutingAccuracy("any", { kb: true, web: false })).toBe(1);
    expect(computeSourceRoutingAccuracy("any", { kb: false, web: true })).toBe(1);
  });

  it("returns 0.5 for kb+web when only one source is used", () => {
    expect(computeSourceRoutingAccuracy("kb+web", { kb: true, web: false })).toBe(0.5);
  });
});

// ── Refusal Accuracy ──

describe("computeRefusalAccuracy", () => {
  it("returns aggregated=1 for non-no_answer sourceType (not applicable)", async () => {
    const result = await computeRefusalAccuracy("kb_only", "some answer", {});
    expect(result.aggregated).toBe(1);
    expect(result.judgeCount).toBe(0);
  });
});
