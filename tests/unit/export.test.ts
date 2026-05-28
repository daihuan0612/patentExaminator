import { describe, it, expect } from "vitest";
import { sanitizeFileName, buildExportFileName } from "@client/lib/fileNameSanitize";
import { renderCaseHtml } from "@client/lib/exportHtml";
import { renderCaseMarkdown } from "@client/lib/exportMarkdown";
import type { ExportViewModel } from "@client/lib/exportHtml";

const MOCK_VIEWMODEL: ExportViewModel = {
  caseData: {
    id: "g1-led",
    applicationNumber: "CN202310001001",
    title: "一种LED散热装置",
    applicationDate: "2023-03-15",
    patentType: "invention",
    textVersion: "original",
    targetClaimNumber: 1,
    guidelineVersion: "2023",
    reexaminationRound: 1,
    workflowState: "claim-chart-reviewed",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z"
  },
  claimFeatures: [
    {
      id: "g1-chart-1-A",
      caseId: "g1-led",
      claimNumber: 1,
      featureCode: "A",
      description: "一种LED散热装置，包括基板",
      specificationCitations: [],
      citationStatus: "confirmed",
      source: "mock"
    }
  ],
  noveltyComparisons: [],
  differenceFeatureCodes: [],
  pendingSearchQuestions: []
};

describe("fileNameSanitize", () => {
  it("T-EXPORT-002: replaces illegal characters", () => {
    const result = sanitizeFileName("file/with\\illegal:chars*?\"<>|");
    expect(result).not.toMatch(/[/\\:*?"<>|]/);
    expect(result).toContain("_");
  });

  it("T-EXPORT-003: truncates long titles to 40 chars", () => {
    const longTitle = "这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题超过四十个字符";
    const result = buildExportFileName("CN202310001001", longTitle, "type", "2023-01-01");
    // Extract title part (between first _ and _type_)
    const titlePart = result.split("_").slice(1, -2).join("_");
    expect(titlePart.length).toBeLessThanOrEqual(40);
  });

  it("builds correct filename format", () => {
    const result = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2023-03-15");
    expect(result).toContain("CN202310001001");
    expect(result).toContain("LED散热");
    expect(result).toContain("审查辅助");
    expect(result).toContain("2023-03-15");
  });

  it("appends sequence number when provided", () => {
    const result = buildExportFileName("CN202310001001", "test", "type", "2023-01-01", 2);
    expect(result).toContain("_2");
  });
});

describe("renderCaseHtml", () => {
  it("T-EXPORT-001: contains case baseline and legal disclaimer", () => {
    const html = renderCaseHtml(MOCK_VIEWMODEL);
    expect(html).toContain("CN202310001001");
    expect(html).toContain("不构成法律结论");
    expect(html).toContain("权利要求特征表");
    expect(html).toContain("<title>");
  });

  it("contains claim features", () => {
    const html = renderCaseHtml(MOCK_VIEWMODEL);
    expect(html).toContain("A");
    expect(html).toContain("LED散热装置");
  });

  it("includes novelty comparisons when present", () => {
    const vmWithNovelty: ExportViewModel = {
      ...MOCK_VIEWMODEL,
      noveltyComparisons: [
        {
          id: "nov-1",
          caseId: "g1-led",
          referenceId: "D1",
          claimNumber: 1,
          rows: [
            {
              featureCode: "A",
              disclosureStatus: "clearly-disclosed",
              citations: []
            }
          ],
          differenceFeatureCodes: ["B"],
          pendingSearchQuestions: [],
          status: "draft",
          legalCaution: "test"
        }
      ]
    };
    const html = renderCaseHtml(vmWithNovelty);
    expect(html).toContain("新颖性对照");
    expect(html).toContain("D1");
  });
});

describe("renderCaseMarkdown", () => {
  it("T-EXPORT-004: returns non-empty string with placeholder", () => {
    const md = renderCaseMarkdown(MOCK_VIEWMODEL);
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("CN202310001001");
    expect(md).toContain("不构成法律结论");
  });

  it("contains claim chart table", () => {
    const md = renderCaseMarkdown(MOCK_VIEWMODEL);
    expect(md).toContain("特征代码");
    expect(md).toContain("特征描述");
  });
});

describe("ExportPanel module", () => {
  it("can be imported", async () => {
    const mod = await import("@client/features/export/ExportPanel");
    expect(mod.ExportPanel).toBeDefined();
    expect(typeof mod.ExportPanel).toBe("function");
  });
});

describe("renderCaseMarkdown null field handling (TC-3)", () => {
  it("renders fallback when applicationNumber is null", () => {
    const vm: ExportViewModel = {
      ...MOCK_VIEWMODEL,
      caseData: { ...MOCK_VIEWMODEL.caseData, applicationNumber: null as unknown as string }
    };
    const md = renderCaseMarkdown(vm);
    expect(md).toContain("（未填写）");
    expect(md).not.toContain("null");
  });

  it("renders fallback when applicationNumber is undefined", () => {
    const vm: ExportViewModel = {
      ...MOCK_VIEWMODEL,
      caseData: { ...MOCK_VIEWMODEL.caseData, applicationNumber: undefined as unknown as string }
    };
    const md = renderCaseMarkdown(vm);
    expect(md).toContain("（未填写）");
  });

  it("renders normal applicationNumber when present", () => {
    const md = renderCaseMarkdown(MOCK_VIEWMODEL);
    expect(md).toContain("CN202310001001");
    expect(md).not.toContain("（未填写）");
  });
});

describe("buildExportFileName serial number (TC-12)", () => {
  it("no sequence number by default", () => {
    const name = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28");
    expect(name).not.toMatch(/_\d+$/);
  });

  it("sequence number 0 is not appended", () => {
    const name = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28", 0);
    expect(name).not.toMatch(/_0$/);
  });

  it("sequence number 1 is appended", () => {
    const name = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28", 1);
    expect(name).toMatch(/_1$/);
  });

  it("sequence number increments correctly", () => {
    const n1 = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28", 1);
    const n2 = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28", 2);
    const n3 = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28", 3);
    expect(n1).toMatch(/_1$/);
    expect(n2).toMatch(/_2$/);
    expect(n3).toMatch(/_3$/);
  });

  it("different dates produce different filenames", () => {
    const d1 = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-27");
    const d2 = buildExportFileName("CN202310001001", "LED散热", "审查辅助", "2026-05-28");
    expect(d1).not.toBe(d2);
    expect(d1).toContain("2026-05-27");
    expect(d2).toContain("2026-05-28");
  });
});
