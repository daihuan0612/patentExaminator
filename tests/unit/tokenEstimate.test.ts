import { describe, it, expect } from "vitest";
import { estimateTokens } from "@client/agent/tokenEstimate";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates Chinese text higher than English per char", () => {
    const zh = estimateTokens("一二三四五");
    const en = estimateTokens("abcde");
    expect(zh).toBeGreaterThan(en);
  });

  it("estimates pure Chinese text", () => {
    const result = estimateTokens("一种LED灯具散热装置");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(50);
  });

  it("estimates pure English text", () => {
    const result = estimateTokens("An LED heat dissipation device");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(30);
  });

  it("estimates mixed Chinese-English text", () => {
    const result = estimateTokens("LED散热装置 heat dissipation");
    expect(result).toBeGreaterThan(0);
  });

  it("returns higher estimate for longer text", () => {
    const short = estimateTokens("短文本");
    const long = estimateTokens("这是一个更长的文本，包含更多的中文字符和English words");
    expect(long).toBeGreaterThan(short);
  });

  it("handles punctuation", () => {
    const result = estimateTokens("Hello, world! 你好！");
    expect(result).toBeGreaterThan(0);
  });

  it("returns integer (ceil)", () => {
    const result = estimateTokens("ab");
    expect(Number.isInteger(result)).toBe(true);
  });
});
