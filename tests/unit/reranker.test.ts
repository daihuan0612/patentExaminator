/**
 * reranker.test.ts — Cross-Encoder 重排序器测试
 * =============================================
 * BUG-141: 离线模型、加载超时、启动预加载
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { localRerank, preloadCrossEncoder } from "@server/lib/reranker.js";

describe("localRerank", () => {
  const makeResult = (chunkId: string, score: number, text = "测试文本", metadata: Record<string, unknown> = {}) => ({
    chunkId, text, metadata, score,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TC-RERANK-001: 单个候选直接返回", () => {
    const results = [makeResult("c1", 0.8)];
    const reranked = localRerank(results, "查询");
    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.chunkId).toBe("c1");
  });

  it("TC-RERANK-002: 空候选返回空数组", () => {
    const reranked = localRerank([], "查询");
    expect(reranked).toEqual([]);
  });

  it("TC-RERANK-003: 多候选按综合分数排序", () => {
    const results = [
      makeResult("c1", 0.3, "专利法实施细则 复审请求"),
      makeResult("c2", 0.8, "无关文本"),
      makeResult("c3", 0.5, "复审 请求书 专利法"),
    ];
    const reranked = localRerank(results, "复审请求");
    expect(reranked).toHaveLength(3);
    // 分数应该从高到低排列
    for (let i = 0; i < reranked.length - 1; i++) {
      expect(reranked[i]!.score).toBeGreaterThanOrEqual(reranked[i + 1]!.score);
    }
  });

  it("TC-RERANK-004: 法律文档使用专用权重", () => {
    const results = [
      makeResult("c1", 0.5, "第六十五条 复审请求", { documentCategory: "法律", articleRefs: ["第六十五条"] }),
      makeResult("c2", 0.8, "无关文本", { documentCategory: "其他" }),
    ];
    const reranked = localRerank(results, "第六十五条");
    // 法律文档中法条引用匹配权重更高，应排在前面
    expect(reranked[0]!.chunkId).toBe("c1");
  });
});

describe("preloadCrossEncoder", () => {
  it("TC-RERANK-005: preloadCrossEncoder 是导出的函数", () => {
    expect(typeof preloadCrossEncoder).toBe("function");
  });

  it("TC-RERANK-006: preloadCrossEncoder 不抛出异常", () => {
    // 预加载可能因环境缺少模型而失败，但不应抛出同步异常
    expect(() => preloadCrossEncoder()).not.toThrow();
  });
});
