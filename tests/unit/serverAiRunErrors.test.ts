import { describe, it, expect } from "vitest";
import { extractJsonFromText } from "@server/lib/jsonExtractor";
import { validateAgentResponse, isStructuredAgent } from "@shared/lib/responseValidator";

// TC-7: server /ai/run error path tests
// Tests the error handling logic used in server/src/routes/ai.ts

describe("extractJsonFromText error paths (TC-7)", () => {
  it("returns null for empty string", () => {
    expect(extractJsonFromText("")).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(extractJsonFromText("This is just plain text with no JSON.")).toBeNull();
  });

  it("extracts JSON from mixed text with markdown fences", () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    const result = extractJsonFromText(text);
    expect(result).not.toBeNull();
    expect(result!.parsed).toEqual({ key: "value" });
  });

  it("extracts top-level array", () => {
    const text = '[{"id": 1}, {"id": 2}]';
    const result = extractJsonFromText(text);
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.parsed)).toBe(true);
  });

  it("returns null for malformed JSON", () => {
    expect(extractJsonFromText('{"key": "value",}')).toBeNull();
  });
});

describe("validateAgentResponse error paths (TC-7)", () => {
  it("rejects null input for structured agent", () => {
    const result = validateAgentResponse("claim-chart", null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects undefined input for structured agent", () => {
    const result = validateAgentResponse("novelty", undefined);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong structure for claim-chart", () => {
    const result = validateAgentResponse("claim-chart", { wrong: "structure" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts valid claim-chart structure", () => {
    const valid = {
      claimNumber: 1,
      features: [
        { featureCode: "A", description: "test", specificationCitations: [], citationStatus: "confirmed" }
      ],
      warnings: [],
      pendingSearchQuestions: [],
      legalCaution: "test"
    };
    const result = validateAgentResponse("claim-chart", valid);
    expect(result.valid).toBe(true);
  });

  it("non-structured agent passes any input", () => {
    expect(isStructuredAgent("chat")).toBe(false);
    const result = validateAgentResponse("chat", { anything: "goes" });
    expect(result.valid).toBe(true);
  });
});
