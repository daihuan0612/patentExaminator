/**
 * queryExpand.test.ts — 查询扩展模块测试
 */
import { describe, it, expect } from "vitest";
import { expandQueryFull, generateMultiQueries } from "@server/lib/queryExpand.js";

describe("queryExpand", () => {
  describe("expandQueryFull", () => {
    it("保留原始查询", () => {
      const result = expandQueryFull("复审需要哪些文件");
      expect(result).toContain("复审需要哪些文件");
    });

    it("扩展法律同义词", () => {
      const result = expandQueryFull("新颖性判断");
      expect(result).toContain("新颖性");
      expect(result).toContain("novelty");
    });

    it("扩展跨语言术语", () => {
      const result = expandQueryFull("权利要求解释");
      expect(result).toContain("claim");
    });
  });

  describe("generateMultiQueries", () => {
    it("至少返回原始查询", () => {
      const queries = generateMultiQueries("复审需要哪些文件");
      expect(queries.length).toBeGreaterThanOrEqual(1);
      expect(queries[0]).toBe("复审需要哪些文件");
    });

    it("生成多个子查询", () => {
      const queries = generateMultiQueries("复审需要提交哪些文件材料");
      expect(queries.length).toBeGreaterThan(1);
    });

    it("子查询不重复", () => {
      const queries = generateMultiQueries("新颖性判断标准");
      const unique = new Set(queries);
      expect(unique.size).toBe(queries.length);
    });

    it("每个子查询非空", () => {
      const queries = generateMultiQueries("创造性三步法评价");
      for (const q of queries) {
        expect(q.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
