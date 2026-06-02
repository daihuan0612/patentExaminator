import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock agentRun before importing
vi.mock("@client/lib/repos", () => ({
  agentRun: vi.fn()
}));

// Mock parseClaims
vi.mock("@client/lib/claimParser", () => ({
  parseClaims: vi.fn()
}));

import { extractCaseFields, extractCaseFieldsFallback } from "@client/lib/caseFieldExtractor";
import { agentRun } from "@client/lib/repos";
import { parseClaims } from "@client/lib/claimParser";

const mockAgentRun = vi.mocked(agentRun);
const mockParseClaims = vi.mocked(parseClaims);

const SETTINGS = {
  mode: "real" as const,
  guidelineVersion: "2023",
  providers: [],
  agents: [],
  searchProviders: []
};

describe("caseFieldExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractCaseFields (AI path)", () => {
    it("TC-EXTRACT-001: successful extraction with all fields", async () => {
      mockAgentRun.mockResolvedValue({
        title: "一种LED散热装置",
        applicationNumber: "CN202310001001A",
        applicant: "测试申请人",
        applicationDate: "2023-03-15",
        priorityDate: null,
        claims: [
          { claimNumber: 1, type: "independent", dependsOn: [], rawText: "一种LED散热装置..." },
          { claimNumber: 2, type: "dependent", dependsOn: [1], rawText: "根据权利要求1..." }
        ]
      });

      const docs = [{ fileName: "申请文件.pdf", text: "专利文本内容" }];
      const result = await extractCaseFields(docs, "case-1", SETTINGS);

      expect(result.title).toBe("一种LED散热装置");
      expect(result.applicationNumber).toBe("CN202310001001A");
      expect(result.applicant).toBe("测试申请人");
      expect(result.applicationDate).toBe("2023-03-15");
      expect(result.priorityDate).toBeNull();
      expect(result.targetClaimNumber).toBe(1);
      expect(result.claims).toHaveLength(2);
      expect(result.claims[0]!.id).toBe("case-1-claim-1");
      expect(result.claims[0]!.caseId).toBe("case-1");
      expect(result.confidence.title).toBe("high");
      expect(result.confidence.applicationNumber).toBe("high");
    });

    it("TC-EXTRACT-002: extraction with null fields", async () => {
      mockAgentRun.mockResolvedValue({
        title: null,
        applicationNumber: null,
        applicant: null,
        applicationDate: null,
        priorityDate: null,
        claims: []
      });

      const docs = [{ fileName: "test.txt", text: "无结构化文本" }];
      const result = await extractCaseFields(docs, "case-2", SETTINGS);

      expect(result.title).toBeNull();
      expect(result.applicationNumber).toBeNull();
      expect(result.targetClaimNumber).toBeNull();
      expect(result.claims).toHaveLength(0);
      expect(result.confidence.title).toBeNull();
      expect(result.confidence.applicationNumber).toBeNull();
    });

    it("TC-EXTRACT-003: malformed response - missing claims array", async () => {
      mockAgentRun.mockResolvedValue({
        title: "测试专利",
        applicationNumber: "CN202310001001A",
        applicant: null,
        applicationDate: null,
        priorityDate: null,
        claims: undefined as unknown as never[]
      });

      const docs = [{ fileName: "test.pdf", text: "内容" }];
      const result = await extractCaseFields(docs, "case-3", SETTINGS);

      // Should handle missing claims gracefully
      expect(result.claims).toEqual([]);
      expect(result.title).toBe("测试专利");
      expect(result.targetClaimNumber).toBe(1); // fallback when title exists
    });

    it("TC-EXTRACT-004: agentRun throws error", async () => {
      mockAgentRun.mockRejectedValue(new Error("AI service unavailable"));

      const docs = [{ fileName: "test.pdf", text: "内容" }];

      await expect(extractCaseFields(docs, "case-4", SETTINGS)).rejects.toThrow("AI service unavailable");
    });

    it("TC-EXTRACT-005: claims with multiple independent claims", async () => {
      mockAgentRun.mockResolvedValue({
        title: "复合装置",
        applicationNumber: "CN202310002002A",
        applicant: "申请人",
        applicationDate: "2023-07-20",
        priorityDate: null,
        claims: [
          { claimNumber: 1, type: "independent", dependsOn: [], rawText: "装置A..." },
          { claimNumber: 2, type: "dependent", dependsOn: [1], rawText: "从权..." },
          { claimNumber: 4, type: "independent", dependsOn: [], rawText: "装置B..." }
        ]
      });

      const docs = [{ fileName: "test.pdf", text: "内容" }];
      const result = await extractCaseFields(docs, "case-5", SETTINGS);

      // Should select smallest independent claim number
      expect(result.targetClaimNumber).toBe(1);
      expect(result.claims).toHaveLength(3);
    });
  });

  describe("extractCaseFieldsFallback (regex path)", () => {
    it("TC-FALLBACK-001: extract labeled fields", async () => {
      const text = `发明名称：一种智能温控系统
申请号：CN202310003003A
申请人：测试公司
申请日：2023-09-01`;

      mockParseClaims.mockResolvedValue({
        claims: [
          { id: "c1", caseId: "case-6", claimNumber: 1, type: "independent", dependsOn: [], rawText: "传感器节点..." }
        ]
      });

      const result = await extractCaseFieldsFallback([{ fileName: "test.txt", text }], "case-6");

      expect(result.title).toBe("一种智能温控系统");
      expect(result.applicationNumber).toBe("CN202310003003A");
      expect(result.applicant).toBe("测试公司");
      expect(result.applicationDate).toBe("2023-09-01");
      expect(result.priorityDate).toBeNull();
      expect(result.targetClaimNumber).toBe(1);
      expect(result.confidence.title).toBe("high");
    });

    it("TC-FALLBACK-002: extract standalone CN number", async () => {
      const text = "本专利 CN202310004004A 涉及一种装置。";
      mockParseClaims.mockResolvedValue({ claims: [] });

      const result = await extractCaseFieldsFallback([{ fileName: "test.txt", text }], "case-7");

      expect(result.applicationNumber).toBe("CN202310004004A");
      expect(result.confidence.applicationNumber).toBe("high");
    });

    it("TC-FALLBACK-003: no extractable fields", async () => {
      const text = "这是一段没有结构化信息的普通文本。";
      mockParseClaims.mockResolvedValue({ claims: [] });

      const result = await extractCaseFieldsFallback([{ fileName: "test.txt", text }], "case-8");

      expect(result.title).toBeNull();
      expect(result.applicationNumber).toBeNull();
      expect(result.applicant).toBeNull();
      expect(result.applicationDate).toBeNull();
      expect(result.priorityDate).toBeNull();
      expect(result.targetClaimNumber).toBeNull();
      expect(result.confidence.title).toBeNull();
    });

    it("TC-FALLBACK-004: parseClaims failure", async () => {
      const text = "发明名称：测试专利\n申请号：CN202310005005A";
      mockParseClaims.mockRejectedValue(new Error("parse failed"));

      const result = await extractCaseFieldsFallback([{ fileName: "test.txt", text }], "case-9");

      // Should still extract bibliographic fields
      expect(result.title).toBe("测试专利");
      expect(result.applicationNumber).toBe("CN202310005005A");
      // Claims should be empty due to parse failure
      expect(result.claims).toEqual([]);
      expect(result.targetClaimNumber).toBeNull();
    });

    it("TC-FALLBACK-005: date with different formats", async () => {
      const text = "申请日：2023年03月15日\n优先权日：2022.11.08";
      mockParseClaims.mockResolvedValue({ claims: [] });

      const result = await extractCaseFieldsFallback([{ fileName: "test.txt", text }], "case-10");

      expect(result.applicationDate).toBe("2023-03-15");
      expect(result.priorityDate).toBe("2022-11-08");
    });
  });
});
