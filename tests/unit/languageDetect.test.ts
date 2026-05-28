import { describe, it, expect } from "vitest";
import { detectLanguage } from "@client/lib/languageDetect";

describe("detectLanguage", () => {
  it("returns 'zh' for pure Chinese text", () => {
    expect(detectLanguage("一种LED灯具散热装置")).toBe("zh");
  });

  it("returns 'en' for pure English text", () => {
    expect(detectLanguage("An LED heat dissipation device")).toBe("en");
  });

  it("returns 'zh' for mixed text with >= 30% CJK", () => {
    // 5 CJK chars out of 12 total = 42%
    expect(detectLanguage("LED散热装置 heat")).toBe("zh");
  });

  it("returns 'en' for mixed text with < 30% CJK", () => {
    // 2 CJK chars out of 15 total = 13%
    expect(detectLanguage("The LED 散热 device is good")).toBe("en");
  });

  it("returns 'other' for empty string", () => {
    expect(detectLanguage("")).toBe("other");
  });

  it("returns 'other' for whitespace-only string", () => {
    expect(detectLanguage("   ")).toBe("other");
  });

  it("handles punctuation correctly (not counted as CJK)", () => {
    expect(detectLanguage("Hello, world! 123")).toBe("en");
  });

  it("handles Chinese punctuation", () => {
    // Chinese punctuation is in CJK ranges
    expect(detectLanguage("。，、；：")).toBe("zh");
  });

  it("handles boundary at exactly 30%", () => {
    // 3 CJK out of 10 non-whitespace = 30%
    expect(detectLanguage("abcdefg中文日")).toBe("zh");
  });

  it("handles boundary just below 30%", () => {
    // 2 CJK out of 10 = 20%
    expect(detectLanguage("abcdefg中文hi")).toBe("en");
  });
});
