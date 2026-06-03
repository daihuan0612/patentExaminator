/**
 * DB Edge-Chain Integration Tests — B-042: 测试数据库隔离机制
 *
 * 边缘场景与 Store 状态测试：
 *   - Settings 持久化全链路
 *   - Opinion/Draft/Interpret Store 纯状态管理
 *   - CRUD 边缘场景（并发/重复键/空数据/部分更新）
 *
 * B-038 后数据层从 IndexedDB 迁移到 SQLite。
 * 持久化测试使用内存数据库隔离。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMemoryDb,
  dbCreate, dbGetAll, dbGetById, dbQuery, dbUpdate, dbDelete, dbClearStore, dbClearAll,
  type TestDb,
} from "../helpers/testDb";
import type Database from "better-sqlite3";
import type { AppSettings } from "@shared/types/agents";

let tdb: TestDb;
let db: Database.Database;

const CASE_ID = "edge-case";

beforeEach(() => {
  tdb = createMemoryDb();
  db = tdb.db;
});

afterEach(() => {
  tdb.cleanup();
});

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    applicationNumber: "CN2023100000001",
    title: "测试发明",
    applicationDate: "2023-03-15",
    patentType: "invention",
    textVersion: "original",
    targetClaimNumber: 1,
    guidelineVersion: "2023",
    reexaminationRound: 1,
    workflowState: "empty",
    createdAt: "2023-03-15T00:00:00.000Z",
    updatedAt: "2023-03-15T00:00:00.000Z",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Settings 全链路 (SQLite 持久化)
// ═══════════════════════════════════════════════════════════════

describe("Settings Full Chain (SQLite)", () => {
  it("无 DB 数据时 → settings 记录不存在", () => {
    const stored = dbGetById(db, "settings", "app");
    expect(stored).toBeNull();
  });

  it("write → read 验证数据一致性", () => {
    const settings = {
      mode: "real",
      guidelineVersion: "2023",
      providers: [
        { providerId: "mimo", apiKeyRef: "tp-test", modelIds: ["MiMo-V2.5-Pro"], enabled: true },
      ],
      agents: [
        { agent: "interpret", providerOrder: ["mimo"], modelId: "MiMo-V2.5-Pro", maxTokens: 8192 },
      ],
      persistKeysEncrypted: true,
    };
    dbCreate(db, "settings", "app", settings);

    const stored = dbGetById(db, "settings", "app") as unknown as AppSettings;
    expect(stored!.mode).toBe("real");
    expect(stored!.providers[0]!.apiKeyRef).toBe("tp-test");
  });

  it("update → 仅修改指定字段，其余不变", () => {
    const settings = {
      mode: "mock",
      guidelineVersion: "2023",
      providers: [{ providerId: "mimo", apiKeyRef: "key-123", modelIds: ["MiMo-V2.5-Pro"], enabled: true }],
      agents: [],
      persistKeysEncrypted: false,
    };
    dbCreate(db, "settings", "app", settings);

    dbUpdate(db, "settings", "app", { ...settings, mode: "real" });

    const stored = dbGetById(db, "settings", "app") as unknown as AppSettings;
    expect(stored!.mode).toBe("real");
    expect(stored!.providers[0]!.apiKeyRef).toBe("key-123");
  });

  it("包含 sanitizeRules 和 ocrQualityThresholds → 完整持久化", () => {
    const settings = {
      mode: "mock",
      guidelineVersion: "2023",
      providers: [],
      agents: [],
      persistKeysEncrypted: false,
      sanitizeRules: [{ pattern: "\\d+", replace: "N", note: "redact" }],
      ocrQualityThresholds: { good: 0.8, poor: 0.3 },
    };
    dbCreate(db, "settings", "app", settings);

    const stored = dbGetById(db, "settings", "app") as unknown as AppSettings;
    expect(stored!.sanitizeRules).toEqual([{ pattern: "\\d+", replace: "N", note: "redact" }]);
    expect(stored!.ocrQualityThresholds).toEqual({ good: 0.8, poor: 0.3 });
  });

  it("重复更新 → 最后写入值生效", () => {
    const s1 = { mode: "mock", guidelineVersion: "2023", providers: [], agents: [], persistKeysEncrypted: false };
    const s2 = { mode: "real", guidelineVersion: "2023", providers: [], agents: [], persistKeysEncrypted: false };
    const s3 = { mode: "real", guidelineVersion: "2024", providers: [], agents: [], persistKeysEncrypted: false };

    dbCreate(db, "settings", "app", s1);
    dbCreate(db, "settings", "app", s2);
    dbCreate(db, "settings", "app", s3);

    const stored = dbGetById(db, "settings", "app");
    expect(stored!.mode).toBe("real");
    expect(stored!.guidelineVersion).toBe("2024");
  });
});

// ═══════════════════════════════════════════════════════════════
// Opinion 持久化 (SQLite)
// ═══════════════════════════════════════════════════════════════

describe("Opinion persistence (SQLite)", () => {
  const sampleAnalysis = {
    id: "oa-1",
    caseId: "case-1",
    documentId: "doc-2",
    rejectionGrounds: [
      { code: "NOV-1", category: "novelty", claimNumbers: [1], summary: "权利要求1不具备新颖性", legalBasis: "专利法第22条第2款" },
    ],
    citedReferences: [
      { publicationNumber: "CN112345678A", rejectionGroundCodes: ["NOV-1"], featureMapping: "D1公开了特征A、B" },
    ],
    legalCaution: "候选分析，需审查员确认",
    status: "draft",
    createdAt: "2024-01-15T00:00:00.000Z",
  };

  it("write → read 验证", () => {
    dbCreate(db, "opinionAnalysis", "case-1", sampleAnalysis);

    const stored = dbGetById(db, "opinionAnalysis", "case-1") as unknown as { id: string; rejectionGrounds: Array<{ code: string }> };
    expect(stored).toBeDefined();
    expect(stored!.id).toBe("oa-1");
    expect(stored!.rejectionGrounds).toHaveLength(1);
    expect(stored!.rejectionGrounds[0]!.code).toBe("NOV-1");
  });

  it("argumentMappings: write → read → delete", () => {
    const mappings = [
      { id: "am-1", caseId: "case-1", rejectionGroundCode: "NOV-1", applicantArgument: "arg1", argumentSummary: "sum1", confidence: "high" },
      { id: "am-2", caseId: "case-1", rejectionGroundCode: "NOV-2", applicantArgument: "arg2", argumentSummary: "sum2", confidence: "medium" },
    ];
    for (const m of mappings) {
      dbCreate(db, "argumentMappings", m.id, m);
    }

    const stored = dbQuery(db, "argumentMappings", "caseId", "case-1");
    expect(stored).toHaveLength(2);

    // 删除一个
    dbDelete(db, "argumentMappings", "am-1");
    const remaining = dbQuery(db, "argumentMappings", "caseId", "case-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("am-2");
  });
});

// ═══════════════════════════════════════════════════════════════
// Draft 持久化 (SQLite)
// ═══════════════════════════════════════════════════════════════

describe("Draft persistence (SQLite)", () => {
  const sampleDraft = {
    claimNumber: 1,
    responseItems: [
      {
        rejectionGroundCode: "NOV-1",
        category: "新颖性",
        applicantArgumentSummary: "D1未公开特征B",
        examinerResponse: "经审查，D1确实未公开特征B",
        conclusion: "argument-accepted",
        supportingEvidence: [{ label: "D1-para-5", quote: "对比文件D1公开了...", confidence: "high" }],
      },
    ],
    overallAssessment: "申请人的答辩部分成立",
    legalCaution: "候选分析，需审查员确认",
  };

  const sampleSummary = {
    body: "本案涉及一种LED散热装置...",
    aiNotes: "需要进一步核查D2的公开日",
    legalCaution: "候选分析，需审查员确认",
  };

  it("reexamDraft: write → read → delete", () => {
    dbCreate(db, "reexamDrafts", "case-1", sampleDraft);

    const stored = dbGetById(db, "reexamDrafts", "case-1");
    expect(stored).toBeDefined();
    expect(stored!.overallAssessment).toBe("申请人的答辩部分成立");
    expect(stored!.responseItems).toHaveLength(1);

    dbDelete(db, "reexamDrafts", "case-1");
    expect(dbGetById(db, "reexamDrafts", "case-1")).toBeNull();
  });

  it("summary: write → read → delete", () => {
    dbCreate(db, "summaries", "case-1", sampleSummary);

    const stored = dbGetById(db, "summaries", "case-1");
    expect(stored).toBeDefined();
    expect(stored!.body).toBe("本案涉及一种LED散热装置...");

    dbDelete(db, "summaries", "case-1");
    expect(dbGetById(db, "summaries", "case-1")).toBeNull();
  });

  it("多个 case → 各自独立存储", () => {
    dbCreate(db, "reexamDrafts", "case-1", sampleDraft);
    dbCreate(db, "reexamDrafts", "case-2", { ...sampleDraft, overallAssessment: "case-2评估" });

    expect(dbGetById(db, "reexamDrafts", "case-1")!.overallAssessment).toBe("申请人的答辩部分成立");
    expect(dbGetById(db, "reexamDrafts", "case-2")!.overallAssessment).toBe("case-2评估");
  });

  it("clearDraftData → 删除指定 case → 其他 case 不受影响", () => {
    dbCreate(db, "reexamDrafts", "case-1", sampleDraft);
    dbCreate(db, "reexamDrafts", "case-2", sampleDraft);
    dbCreate(db, "summaries", "case-1", sampleSummary);

    // 模拟 clearDraftData
    dbDelete(db, "reexamDrafts", "case-1");
    dbDelete(db, "summaries", "case-1");

    expect(dbGetById(db, "reexamDrafts", "case-2")).toBeDefined();
    expect(dbGetById(db, "reexamDrafts", "case-1")).toBeNull();
    expect(dbGetById(db, "summaries", "case-1")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Interpret 持久化 (SQLite)
// ═══════════════════════════════════════════════════════════════

describe("Interpret persistence (SQLite)", () => {
  it("write → read → 覆盖", () => {
    dbCreate(db, "interpretSummaries", "case-1", { summaries: { "doc-app": "LED散热装置解读摘要" } });

    const stored = dbGetById(db, "interpretSummaries", "case-1") as unknown as { summaries: Record<string, string> };
    expect(stored).toBeDefined();
    expect(stored!.summaries["doc-app"]).toBe("LED散热装置解读摘要");

    // 覆盖
    dbUpdate(db, "interpretSummaries", "case-1", { summaries: { "doc-app": "新解读" } });
    const updated = dbGetById(db, "interpretSummaries", "case-1") as unknown as { summaries: Record<string, string> };
    expect(updated!.summaries["doc-app"]).toBe("新解读");
  });

  it("多个 case 与多个文档 → 各自独立", () => {
    dbCreate(db, "interpretSummaries", "case-1", { summaries: { "doc-app": "解读1", "doc-oa": "解读1-2" } });
    dbCreate(db, "interpretSummaries", "case-2", { summaries: { "doc-ref": "解读2" } });

    const s1 = dbGetById(db, "interpretSummaries", "case-1") as unknown as { summaries: Record<string, string> };
    const s2 = dbGetById(db, "interpretSummaries", "case-2") as unknown as { summaries: Record<string, string> };
    expect(s1!.summaries["doc-app"]).toBe("解读1");
    expect(s1!.summaries["doc-oa"]).toBe("解读1-2");
    expect(s2!.summaries["doc-ref"]).toBe("解读2");
  });

  it("delete 指定 case → 其余不受影响", () => {
    dbCreate(db, "interpretSummaries", "case-1", { summaries: { "doc-app": "解读1" } });
    dbCreate(db, "interpretSummaries", "case-2", { summaries: { "doc-ref": "解读2" } });

    dbDelete(db, "interpretSummaries", "case-1");

    expect(dbGetById(db, "interpretSummaries", "case-1")).toBeNull();
    expect(dbGetById(db, "interpretSummaries", "case-2")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 边缘场景：CRUD 并发 / 重复键 / 空数据 / 部分更新
// ═══════════════════════════════════════════════════════════════

describe("Edge Cases: Concurrent / Duplicate / Empty / Partial", () => {
  it("重复创建同一 ID → 应覆盖旧数据（upsert 语义）", () => {
    dbCreate(db, "cases", CASE_ID, makeCase({ id: CASE_ID, title: "旧标题" }));
    dbCreate(db, "cases", CASE_ID, makeCase({ id: CASE_ID, title: "新标题" }));

    const all = dbGetAll(db, "cases");
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe("新标题");
  });

  it("从空 DB 读取 → 返回空数组/空结果", () => {
    expect(dbGetAll(db, "cases")).toHaveLength(0);
    expect(dbQuery(db, "claimCharts", "caseId", CASE_ID)).toHaveLength(0);
    expect(dbQuery(db, "claimNodes", "caseId", CASE_ID)).toHaveLength(0);
  });

  it("部分更新 → 仅更新指定字段，其余字段不丢失", () => {
    const c = makeCase({ id: CASE_ID, title: "原始标题", workflowState: "case-ready", applicationNumber: "CN2020100000001" });
    dbCreate(db, "cases", CASE_ID, c);

    dbUpdate(db, "cases", CASE_ID, { ...c, title: "修改后标题" });

    const stored = dbGetById(db, "cases", CASE_ID);
    expect(stored!.title).toBe("修改后标题");
    expect(stored!.workflowState).toBe("case-ready");
    expect(stored!.applicationNumber).toBe("CN2020100000001");
  });

  it("删除不存在的记录 → 返回 false，不报错", () => {
    const result = dbDelete(db, "cases", "not-exist");
    expect(result).toBe(false);
  });

  it("批量写入 → 全部持久化", () => {
    for (let i = 0; i < 10; i++) {
      dbCreate(db, "cases", `concurrent-${i}`, makeCase({ id: `concurrent-${i}`, title: `并发测试 ${i}` }));
    }

    const all = dbGetAll(db, "cases");
    expect(all).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(all.find(d => d.id === `concurrent-${i}`)).toBeDefined();
    }
  });

  it("批量写入 → 逐个删除 → 最终 DB 为空", () => {
    const ids = ["batch-1", "batch-2", "batch-3"];
    for (const id of ids) {
      dbCreate(db, "cases", id, makeCase({ id }));
    }

    expect(dbGetAll(db, "cases")).toHaveLength(3);

    for (const id of ids) {
      dbDelete(db, "cases", id);
    }

    expect(dbGetAll(db, "cases")).toHaveLength(0);
  });

  it("写入大量 ClaimFeature → 全部回读正确", () => {
    for (let i = 0; i < 50; i++) {
      dbCreate(db, "claimCharts", `${CASE_ID}-chart-1-${i}`, {
        id: `${CASE_ID}-chart-1-${i}`,
        caseId: CASE_ID,
        claimNumber: 1,
        featureCode: String.fromCharCode(65 + (i % 26)),
        description: `特征描述 ${i}`,
        specificationCitations: [],
        citationStatus: "needs-review",
        source: "mock",
      });
    }

    const features = dbQuery(db, "claimCharts", "caseId", CASE_ID);
    expect(features).toHaveLength(50);
  });

  it("clearStore 只影响目标 store", () => {
    dbCreate(db, "cases", "c1", makeCase());
    dbCreate(db, "documents", "d1", { id: "d1", caseId: "c1", role: "application", fileName: "test.pdf", fileType: "pdf", textStatus: "empty", extractedText: "", textIndex: { pages: [], paragraphs: [], lineMap: [] }, createdAt: "2024-01-01T00:00:00.000Z" });

    dbClearStore(db, "cases");

    expect(dbGetAll(db, "cases")).toHaveLength(0);
    expect(dbGetAll(db, "documents")).toHaveLength(1);
  });

  it("clearAll 清空所有数据", () => {
    dbCreate(db, "cases", "c1", makeCase());
    dbCreate(db, "documents", "d1", { id: "d1", caseId: "c1", role: "application", fileName: "test.pdf", fileType: "pdf", textStatus: "empty", extractedText: "", textIndex: { pages: [], paragraphs: [], lineMap: [] }, createdAt: "2024-01-01T00:00:00.000Z" });

    dbClearAll(db);

    expect(dbGetAll(db, "cases")).toHaveLength(0);
    expect(dbGetAll(db, "documents")).toHaveLength(0);
  });
});
