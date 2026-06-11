/**
 * Unit tests for multiJudge.ts — 多 Judge 聚合算法
 */
import { describe, it, expect } from "vitest";
import {
  aggregateDiscrete,
  aggregateContinuous,
  extractJsonFromLLM,
} from "../../server/src/lib/multiJudge.js";

// ── aggregateDiscrete (Majority Vote) ──

describe("aggregateDiscrete", () => {
  it("returns 0 for empty array", () => {
    expect(aggregateDiscrete([])).toBe(0);
  });

  it("returns the value for single element", () => {
    expect(aggregateDiscrete([3])).toBe(3);
  });

  it("returns average for two elements", () => {
    expect(aggregateDiscrete([2, 3])).toBe(3); // Math.round(2.5) = 3
  });

  it("returns majority when 2/3 agree", () => {
    expect(aggregateDiscrete([3, 3, 2])).toBe(3);
    expect(aggregateDiscrete([1, 2, 1])).toBe(1);
  });

  it("returns median when all 3 differ", () => {
    expect(aggregateDiscrete([0, 2, 3])).toBe(2);
    expect(aggregateDiscrete([1, 3, 2])).toBe(2);
  });

  it("handles all same values", () => {
    expect(aggregateDiscrete([2, 2, 2])).toBe(2);
  });
});

// ── aggregateContinuous (Average) ──

describe("aggregateContinuous", () => {
  it("returns 0 for empty array", () => {
    expect(aggregateContinuous([])).toBe(0);
  });

  it("returns the value for single element", () => {
    expect(aggregateContinuous([0.8])).toBeCloseTo(0.8, 5);
  });

  it("returns average for multiple elements", () => {
    expect(aggregateContinuous([0.6, 0.8, 1.0])).toBeCloseTo(0.8, 5);
  });

  it("handles all zeros", () => {
    expect(aggregateContinuous([0, 0, 0])).toBe(0);
  });

  it("handles all ones", () => {
    expect(aggregateContinuous([1, 1, 1])).toBeCloseTo(1, 5);
  });
});

// ── extractJsonFromLLM ──

describe("extractJsonFromLLM", () => {
  it("parses direct JSON", () => {
    const result = extractJsonFromLLM('{"score": 0.8, "reasoning": "good"}');
    expect(result).toEqual({ score: 0.8, reasoning: "good" });
  });

  it("parses JSON in markdown code block", () => {
    const text = '```json\n{"score": 0.5}\n```';
    expect(extractJsonFromLLM(text)).toEqual({ score: 0.5 });
  });

  it("parses JSON with surrounding text", () => {
    const text = 'Here is the result: {"score": 0.7} end';
    expect(extractJsonFromLLM(text)).toEqual({ score: 0.7 });
  });

  it("returns null for invalid JSON", () => {
    expect(extractJsonFromLLM("not json at all")).toBeNull();
  });

  it("handles nested JSON", () => {
    const text = '{"coverage": [{"fact": "test", "covered": true}], "score": 1.0}';
    const result = extractJsonFromLLM(text);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(1.0);
  });
});
