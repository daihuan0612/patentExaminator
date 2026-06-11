/**
 * Repositories CRUD Integration Tests — B-042: 测试数据库隔离机制
 *
 * 验证 SQLite sync_data 表的 CRUD 操作正确性。
 * 使用内存数据库隔离，不访问生产数据库。
 *
 * 这些测试验证底层持久化操作，与 server/src/routes/data.ts 使用相同 SQL 模式。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMemoryDb,
  dbCreate, dbGetAll, dbGetById, dbQuery, dbUpdate, dbDelete, dbClearStore,
  type TestDb,
} from "../helpers/testDb";
import type Database from "better-sqlite3";

let tdb: TestDb;
let db: Database.Database;

beforeEach(() => {
  tdb = createMemoryDb();
  db = tdb.db;
});

afterEach(() => {
  tdb.cleanup();
});

// ═══════════════════════════════════════════════════════════════
// Helper: 测试数据工厂
// ═══════════════════════════════════════════════════════════════

const testCase = {
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
};

const testDoc = {
  id: "doc-1",
  caseId: "case-1",
  role: "application",
  fileName: "申请文件.pdf",
  fileType: "pdf",
  textStatus: "empty",
  extractedText: "",
  textIndex: { pages: [], paragraphs: [], lineMap: [] },
  createdAt: "2023-03-15T00:00:00.000Z",
};

const testClaimNode = {
  id: "claim-1",
  caseId: "case-1",
  claimNumber: 1,
  type: "independent",
  dependsOn: [],
  rawText: "一种装置，包括A和B",
};

const testClaimFeature = {
  id: "case-1-chart-1-A",
  caseId: "case-1",
  claimNumber: 1,
  featureCode: "A",
  description: "一种装置",
  specificationCitations: [],
  citationStatus: "needs-review",
  source: "mock",
};

const testNovelty = {
  id: "novelty-1",
  caseId: "case-1",
  referenceId: "ref-1",
  claimNumber: 1,
  rows: [],
  differenceFeatureCodes: [],
  pendingSearchQuestions: [],
  status: "draft",
  legalCaution: "以上为候选事实整理，不构成新颖性法律结论。",
};

const testInventive = {
  id: "inventive-1",
  caseId: "case-1",
  sharedFeatureCodes: ["A"],
  distinguishingFeatureCodes: ["B"],
  status: "draft",
  motivationEvidence: [],
  candidateAssessment: "not-analyzed",
  cautions: [],
  legalCaution: "以上为候选事实整理，不构成创造性法律结论。",
};

// ═══════════════════════════════════════════════════════════════
// Cases CRUD
// ═══════════════════════════════════════════════════════════════

describe("caseRepo (SQLite)", () => {
  it("create → readAll → update → delete", () => {
    dbCreate(db, "cases", testCase.id, testCase);
    let all = dbGetAll(db, "cases");
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe("测试发明");

    const byId = dbGetById(db, "cases", "case-1");
    expect(byId).toBeDefined();
    expect(byId!.id).toBe("case-1");

    dbUpdate(db, "cases", testCase.id, { ...testCase, title: "更新后的发明" });
    all = dbGetAll(db, "cases");
    expect(all[0]!.title).toBe("更新后的发明");

    dbDelete(db, "cases", testCase.id);
    all = dbGetAll(db, "cases");
    expect(all).toHaveLength(0);
  });

  it("readAll on empty store returns []", () => {
    const all = dbGetAll(db, "cases");
    expect(all).toHaveLength(0);
  });

  it("readById on nonexistent returns null", () => {
    const result = dbGetById(db, "cases", "nonexistent");
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Documents CRUD
// ═══════════════════════════════════════════════════════════════

describe("documentRepo (SQLite)", () => {
  it("create → readAll → update → delete", () => {
    dbCreate(db, "documents", testDoc.id, testDoc);
    let all = dbGetAll(db, "documents");
    expect(all).toHaveLength(1);

    const byId = dbGetById(db, "documents", "doc-1");
    expect(byId).toBeDefined();

    dbUpdate(db, "documents", testDoc.id, { ...testDoc, textStatus: "extracted", extractedText: "提取的文本" });
    all = dbGetAll(db, "documents");
    expect(all[0]!.textStatus).toBe("extracted");

    dbDelete(db, "documents", testDoc.id);
    all = dbGetAll(db, "documents");
    expect(all).toHaveLength(0);
  });

  it("query by caseId filters correctly", () => {
    dbCreate(db, "documents", "doc-1", { ...testDoc, caseId: "case-1" });
    dbCreate(db, "documents", "doc-2", { ...testDoc, id: "doc-2", caseId: "case-2" });

    const case1Docs = dbQuery(db, "documents", "caseId", "case-1");
    expect(case1Docs).toHaveLength(1);
    expect(case1Docs[0]!.id).toBe("doc-1");

    const case2Docs = dbQuery(db, "documents", "caseId", "case-2");
    expect(case2Docs).toHaveLength(1);
  });

  it("query by role filters correctly", () => {
    dbCreate(db, "documents", "doc-app", { ...testDoc, id: "doc-app", role: "application" });
    dbCreate(db, "documents", "doc-ref", { ...testDoc, id: "doc-ref", role: "reference" });

    const refs = dbQuery(db, "documents", "role", "reference");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.id).toBe("doc-ref");
  });
});

// ═══════════════════════════════════════════════════════════════
// Claim Nodes & Features CRUD
// ═══════════════════════════════════════════════════════════════

describe("claimRepo (SQLite)", () => {
  it("claimNode: create → readByCaseId → delete", () => {
    dbCreate(db, "claimNodes", testClaimNode.id, testClaimNode);
    const nodes = dbQuery(db, "claimNodes", "caseId", "case-1");
    expect(nodes).toHaveLength(1);

    dbDelete(db, "claimNodes", testClaimNode.id);
    const after = dbQuery(db, "claimNodes", "caseId", "case-1");
    expect(after).toHaveLength(0);
  });

  it("claimFeature: create → readByCaseId → update → delete", () => {
    dbCreate(db, "claimCharts", testClaimFeature.id, testClaimFeature);
    let features = dbQuery(db, "claimCharts", "caseId", "case-1");
    expect(features).toHaveLength(1);

    dbUpdate(db, "claimCharts", testClaimFeature.id, { ...testClaimFeature, citationStatus: "confirmed" });
    features = dbQuery(db, "claimCharts", "caseId", "case-1");
    expect(features[0]!.citationStatus).toBe("confirmed");

    dbDelete(db, "claimCharts", testClaimFeature.id);
    features = dbQuery(db, "claimCharts", "caseId", "case-1");
    expect(features).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Novelty CRUD
// ═══════════════════════════════════════════════════════════════

describe("noveltyRepo (SQLite)", () => {
  it("create → readByCaseId → update → delete", () => {
    dbCreate(db, "novelty", testNovelty.id, testNovelty);
    let all = dbQuery(db, "novelty", "caseId", "case-1");
    expect(all).toHaveLength(1);

    dbUpdate(db, "novelty", testNovelty.id, { ...testNovelty, status: "user-reviewed" });
    all = dbQuery(db, "novelty", "caseId", "case-1");
    expect(all[0]!.status).toBe("user-reviewed");

    dbDelete(db, "novelty", testNovelty.id);
    all = dbQuery(db, "novelty", "caseId", "case-1");
    expect(all).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Inventive CRUD
// ═══════════════════════════════════════════════════════════════

describe("inventiveRepo (SQLite)", () => {
  it("create → readByCaseId → update → delete", () => {
    dbCreate(db, "inventive", testInventive.id, testInventive);
    let all = dbQuery(db, "inventive", "caseId", "case-1");
    expect(all).toHaveLength(1);

    dbUpdate(db, "inventive", testInventive.id, { ...testInventive, status: "user-reviewed" });
    all = dbQuery(db, "inventive", "caseId", "case-1");
    expect(all[0]!.status).toBe("user-reviewed");

    dbDelete(db, "inventive", testInventive.id);
    all = dbQuery(db, "inventive", "caseId", "case-1");
    expect(all).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// OCR Cache CRUD
// ═══════════════════════════════════════════════════════════════

describe("ocrCacheRepo (SQLite)", () => {
  it("write → read → delete", () => {
    dbCreate(db, "ocrCache", "key-1", { text: "OCR文本", createdAt: Date.now() });
    const record = dbGetById(db, "ocrCache", "key-1");
    expect(record).toBeDefined();
    expect(record!.text).toBe("OCR文本");

    dbDelete(db, "ocrCache", "key-1");
    const deleted = dbGetById(db, "ocrCache", "key-1");
    expect(deleted).toBeNull();
  });

  it("expired cache entry can be identified", () => {
    // 写入 8 天前的缓存
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    dbCreate(db, "ocrCache", "key-old", { text: "旧文本", createdAt: eightDaysAgo });

    const record = dbGetById(db, "ocrCache", "key-old");
    expect(record).toBeDefined();
    expect(record!.createdAt).toBe(eightDaysAgo);

    // 模拟过期检查逻辑（7 天 TTL）
    const isExpired = (Date.now() - (record!.createdAt as number)) > 7 * 24 * 60 * 60 * 1000;
    expect(isExpired).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Settings CRUD
// ═══════════════════════════════════════════════════════════════

describe("settingsRepo (SQLite)", () => {
  it("write → read → update", () => {
    const settings = {
      mode: "mock",
      guidelineVersion: "2023",
      providers: [],
      agents: [],
      persistKeysEncrypted: false,
    };
    dbCreate(db, "settings", "app", settings);

    const read = dbGetById(db, "settings", "app");
    expect(read).toBeDefined();
    expect(read!.mode).toBe("mock");

    dbUpdate(db, "settings", "app", { ...settings, mode: "real" });
    const updated = dbGetById(db, "settings", "app");
    expect(updated!.mode).toBe("real");
  });
});

// ═══════════════════════════════════════════════════════════════
// Chat Sessions & Messages CRUD
// ═══════════════════════════════════════════════════════════════

describe("chatRepo (SQLite)", () => {
  it("session: create → queryByCaseId → update → delete", () => {
    const session = {
      id: "s1", caseId: "c1", moduleScope: "novelty",
      title: "Test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    dbCreate(db, "chatSessions", session.id, session);

    const sessions = dbQuery(db, "chatSessions", "caseId", "c1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe("Test");

    dbUpdate(db, "chatSessions", session.id, { ...session, title: "Updated" });
    const updated = dbQuery(db, "chatSessions", "caseId", "c1");
    expect(updated[0]!.title).toBe("Updated");

    dbDelete(db, "chatSessions", session.id);
    const remaining = dbQuery(db, "chatSessions", "caseId", "c1");
    expect(remaining).toHaveLength(0);
  });

  it("message: create → queryBySessionId → delete", () => {
    const msg = {
      id: "m1", sessionId: "s1", caseId: "c1", moduleScope: "novelty",
      role: "user", content: "Hello", createdAt: new Date().toISOString(),
    };
    dbCreate(db, "chatMessages", msg.id, msg);

    const messages = dbQuery(db, "chatMessages", "sessionId", "s1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("Hello");

    dbDelete(db, "chatMessages", msg.id);
    const remaining = dbQuery(db, "chatMessages", "sessionId", "s1");
    expect(remaining).toHaveLength(0);
  });

  it("multiple messages per session", () => {
    for (let i = 1; i <= 3; i++) {
      dbCreate(db, "chatMessages", `m${i}`, {
        id: `m${i}`, sessionId: "s1", caseId: "c1", moduleScope: "novelty",
        role: i % 2 === 1 ? "user" : "assistant", content: `消息${i}`, createdAt: new Date().toISOString(),
      });
    }

    const messages = dbQuery(db, "chatMessages", "sessionId", "s1");
    expect(messages).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// Defects CRUD
// ═══════════════════════════════════════════════════════════════

describe("defectRepo (SQLite)", () => {
  it("create → queryByCaseId → update → delete → deleteByCaseId", () => {
    const defect = {
      id: "d1", caseId: "c1", category: "clarity", description: "Test",
      severity: "error", claimNumbers: [1],
    };
    dbCreate(db, "defects", defect.id, defect);

    const defects = dbQuery(db, "defects", "caseId", "c1");
    expect(defects).toHaveLength(1);

    dbUpdate(db, "defects", defect.id, { ...defect, description: "Updated" });
    const updated = dbQuery(db, "defects", "caseId", "c1");
    expect(updated[0]!.description).toBe("Updated");

    dbDelete(db, "defects", defect.id);
    const afterDelete = dbQuery(db, "defects", "caseId", "c1");
    expect(afterDelete).toHaveLength(0);

    // 批量创建 + 按 caseId 删除
    dbCreate(db, "defects", "d2", { ...defect, id: "d2" });
    dbCreate(db, "defects", "d3", { ...defect, id: "d3", caseId: "c2" });

    // 模拟 deleteByCaseId: 查询后逐个删除
    const c1Defects = dbQuery(db, "defects", "caseId", "c1");
    for (const d of c1Defects) {
      dbDelete(db, "defects", d.id);
    }
    expect(dbQuery(db, "defects", "caseId", "c1")).toHaveLength(0);
    expect(dbQuery(db, "defects", "caseId", "c2")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Run Markers CRUD
// ═══════════════════════════════════════════════════════════════

describe("runMarkerRepo (SQLite)", () => {
  it("save → queryByCaseId → delete", () => {
    dbCreate(db, "runMarkers", "c1::claim-chart", { caseId: "c1", module: "claim-chart" });
    dbCreate(db, "runMarkers", "c1::novelty", { caseId: "c1", module: "novelty" });

    const markers = dbQuery(db, "runMarkers", "caseId", "c1");
    expect(markers).toHaveLength(2);
    const modules = markers.map(m => m.module);
    expect(modules).toContain("claim-chart");
    expect(modules).toContain("novelty");

    dbDelete(db, "runMarkers", "c1::claim-chart");
    const afterDelete = dbQuery(db, "runMarkers", "caseId", "c1");
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0]!.module).toBe("novelty");
  });
});

// ═══════════════════════════════════════════════════════════════
// Draft & Summary CRUD
// ═══════════════════════════════════════════════════════════════

describe("draftRepo (SQLite)", () => {
  it("reexamDraft: save → read → delete", () => {
    const draft = { examinerResponse: "test response", overallAssessment: "test", responses: [] };
    dbCreate(db, "reexamDrafts", "c1", draft);

    const read = dbGetById(db, "reexamDrafts", "c1");
    expect(read).toBeDefined();
    expect(read!.examinerResponse).toBe("test response");

    dbDelete(db, "reexamDrafts", "c1");
    const deleted = dbGetById(db, "reexamDrafts", "c1");
    expect(deleted).toBeNull();
  });

  it("summary: save → read → delete", () => {
    const summary = { body: "test body", aiNotes: "test notes" };
    dbCreate(db, "summaries", "c1", summary);

    const read = dbGetById(db, "summaries", "c1");
    expect(read).toBeDefined();
    expect(read!.body).toBe("test body");

    dbDelete(db, "summaries", "c1");
    const deleted = dbGetById(db, "summaries", "c1");
    expect(deleted).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Interpret Summaries CRUD
// ═══════════════════════════════════════════════════════════════

describe("interpretRepo (SQLite)", () => {
  it("save → read → delete", () => {
    const summaries = { doc1: "summary1", doc2: "summary2" };
    dbCreate(db, "interpretSummaries", "c1", { summaries });

    const read = dbGetById(db, "interpretSummaries", "c1");
    expect(read).toBeDefined();
    expect(read!.summaries).toEqual(summaries);

    dbDelete(db, "interpretSummaries", "c1");
    const deleted = dbGetById(db, "interpretSummaries", "c1");
    expect(deleted).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Opinion & Argument Mappings CRUD
// ═══════════════════════════════════════════════════════════════

describe("opinionRepo (SQLite)", () => {
  it("opinionAnalysis: save → read → delete", () => {
    const analysis = {
      id: "oa1", caseId: "c1", documentId: "d1",
      rejectionGrounds: [], citedReferences: [], createdAt: new Date().toISOString(),
    };
    dbCreate(db, "opinionAnalysis", "c1", analysis);

    const read = dbGetById(db, "opinionAnalysis", "c1");
    expect(read).toBeDefined();
    expect(read!.id).toBe("oa1");

    dbDelete(db, "opinionAnalysis", "c1");
    const deleted = dbGetById(db, "opinionAnalysis", "c1");
    expect(deleted).toBeNull();
  });

  it("argumentMappings: save → read → delete", () => {
    const mappings = [
      { id: "am1", caseId: "c1", rejectionGroundCode: "RG-1", applicantArgument: "arg1" },
      { id: "am2", caseId: "c1", rejectionGroundCode: "RG-2", applicantArgument: "arg2" },
    ];
    for (const m of mappings) {
      dbCreate(db, "argumentMappings", m.id, m);
    }

    const read = dbQuery(db, "argumentMappings", "caseId", "c1");
    expect(read).toHaveLength(2);

    for (const m of read) {
      dbDelete(db, "argumentMappings", m.id);
    }
    expect(dbQuery(db, "argumentMappings", "caseId", "c1")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Search Session CRUD
// ═══════════════════════════════════════════════════════════════

describe("searchSessionRepo (SQLite)", () => {
  it("create → queryByCaseId → update → delete", () => {
    const session = {
      id: "ss1", caseId: "c1", query: "test", dataSources: ["tavily"],
      resultCount: 5, status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    dbCreate(db, "searchSessions", session.id, session);

    const sessions = dbQuery(db, "searchSessions", "caseId", "c1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.resultCount).toBe(5);

    dbUpdate(db, "searchSessions", session.id, { ...session, resultCount: 10 });
    const updated = dbQuery(db, "searchSessions", "caseId", "c1");
    expect(updated[0]!.resultCount).toBe(10);

    dbDelete(db, "searchSessions", session.id);
    expect(dbQuery(db, "searchSessions", "caseId", "c1")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 通用 store 清空
// ═══════════════════════════════════════════════════════════════

describe("clearStore (SQLite)", () => {
  it("clearStore only affects target store", () => {
    dbCreate(db, "cases", "c1", testCase);
    dbCreate(db, "documents", "d1", testDoc);

    dbClearStore(db, "cases");
    expect(dbGetAll(db, "cases")).toHaveLength(0);
    expect(dbGetAll(db, "documents")).toHaveLength(1);
  });
});
