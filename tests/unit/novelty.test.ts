import { describe, it, expect } from "vitest";
import noveltyFixture from "@shared/fixtures/novelty-g1-d1.json";
import { noveltySchema } from "@shared/schemas/novelty.schema";

const fixture = noveltyFixture;

describe("Novelty fixture (G1+D1)", () => {
  it("passes noveltySchema validation", () => {
    const fixture = noveltyFixture;
    const result = noveltySchema.safeParse(fixture);
    if (!result.success) {
      console.error("Novelty validation errors:", JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("T-NOV-001: G1+D1 — A=clearly-disclosed, B/C=not-found", () => {
    const fixture = noveltyFixture as unknown as {
      rows: Array<{ featureCode: string; disclosureStatus: string }>;
    };

    const rowA = fixture.rows.find((r) => r.featureCode === "A");
    const rowB = fixture.rows.find((r) => r.featureCode === "B");
    const rowC = fixture.rows.find((r) => r.featureCode === "C");

    expect(rowA?.disclosureStatus).toBe("clearly-disclosed");
    expect(rowB?.disclosureStatus).toBe("not-found");
    expect(rowC?.disclosureStatus).toBe("not-found");
  });

  it("T-NOV-005: differenceFeatureCodes = [B, C] (strict)", () => {
    const fixture = noveltyFixture as unknown as {
      differenceFeatureCodes: string[];
    };

    expect(fixture.differenceFeatureCodes).toEqual(["B", "C"]);
  });

  it("all citations have high or medium confidence", () => {
    const fixture = noveltyFixture as unknown as {
      rows: Array<{ citations: Array<{ confidence: string }> }>;
    };

    for (const row of fixture.rows) {
      for (const citation of row.citations) {
        expect(["high", "medium"]).toContain(citation.confidence);
      }
    }
  });
});

describe("Novelty fixture for G1+D1", () => {
  it("returns novelty fixture for G1+D1", async () => {
    const result = fixture as unknown as {
      rows: Array<{ featureCode: string; disclosureStatus: string }>;
      differenceFeatureCodes: string[];
      legalCaution: string;
    };

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.differenceFeatureCodes).toContain("B");
    expect(result.differenceFeatureCodes).toContain("C");
    expect(result.legalCaution).toContain("不构成");
  });

  it("T-NOV-004: fixture with missing paragraph still has rows", () => {
    const fixture = noveltyFixture as unknown as {
      rows: Array<{ featureCode: string; citations: Array<{ confidence: string }> }>;
    };

    // All rows exist
    expect(fixture.rows.length).toBe(3);

    // Rows with empty citations (B, C) are still present
    const rowB = fixture.rows.find((r) => r.featureCode === "B");
    expect(rowB).toBeDefined();
    expect(rowB!.citations).toEqual([]);
  });
});
