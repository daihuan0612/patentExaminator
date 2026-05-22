import { describe, it, expect } from "vitest";
import { validateAgentResponse } from "@shared/lib/responseValidator";

describe("validateAgentResponse", () => {
  it("claim-chart accepts numeric paragraph and coerces to string in data", () => {
    const result = validateAgentResponse("claim-chart", {
      claimNumber: 1,
      features: [
        {
          featureCode: "A",
          description: "一种装置",
          specificationCitations: [
            { label: "说明书第001段", paragraph: 5, confidence: "high" }
          ],
          citationStatus: "confirmed"
        }
      ]
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    const parsed = result.data as {
      features: Array<{
        specificationCitations: Array<{ paragraph?: string }>;
      }>;
    };
    expect(parsed.features[0]?.specificationCitations[0]?.paragraph).toBe("5");
  });

  it("claim-chart rejects invalid featureCode", () => {
    const result = validateAgentResponse("claim-chart", {
      claimNumber: 1,
      features: [
        {
          featureCode: "abc",
          description: "test",
          specificationCitations: [],
          citationStatus: "confirmed"
        }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
