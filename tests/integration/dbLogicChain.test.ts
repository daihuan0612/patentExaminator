/**
 * DB Logic-Chain Integration Tests — B-042: 测试数据库隔离机制
 *
 * 测试目标：验证 SQLite 持久化层的完整 CRUD 逻辑链路。
 *
 * B-038 后数据层从 IndexedDB 迁移到 SQLite（syncDb.ts），
 * 每条链路覆盖：Create → Read → Update → Delete → Readback 验证。
 * 使用内存数据库隔离，不访问生产数据库。
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
// Helper factories
// ═══════════════════════════════════════════════════════════════

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

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    caseId: "case-1",
    role: "application",
    fileName: "申请文件.pdf",
    fileType: "pdf",
    textStatus: "extracted",
    extractedText: "本发明涉及一种测试装置。",
    textIndex: { pages: [], paragraphs: [], lineMap: [] },
    createdAt: "2023-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function makeClaimNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "claim-1",
    caseId: "case-1",
    claimNumber: 1,
    type: "independent",
    dependsOn: [],
    rawText: "一种装置，包括A和B",
    ...overrides,
  };
}

function makeClaimFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1-chart-1-A",
    caseId: "case-1",
    claimNumber: 1,
    featureCode: "A",
    description: "一种装置",
    specificationCitations: [],
    citationStatus: "needs-review",
    source: "mock",
    ...overrides,
  };
}

function makeNovelty(overrides: Record<string, unknown> = {}) {
  return {
    id: "novelty-1",
    caseId: "case-1",
    referenceId: "ref-1",
    claimNumber: 1,
    rows: [
      { featureCode: "A", disclosureStatus: "clearly-disclosed", citations: [], mismatchNotes: "" },
    ],
    differenceFeatureCodes: ["B"],
    pendingSearchQuestions: [],
    status: "draft",
    legalCaution: "候选事实整理，不构成法律结论。",
    ...overrides,
  };
}

function makeInventive(overrides: Record<string, unknown> = {}) {
  return {
    id: "inventive-case-1-1",
    caseId: "case-1",
    sharedFeatureCodes: ["A"],
    distinguishingFeatureCodes: ["B"],
    status: "draft",
    motivationEvidence: [],
    candidateAssessment: "not-analyzed",
    cautions: [],
    legalCaution: "候选事实整理，不构成法律结论。",
    ...overrides,
  };
}

function makeDefect(overrides: Record<string, unknown> = {}) {
  return {
    id: "defect-1",
    caseId: "case-1",
    category: "权利要求",
    description: "权利要求1不清楚",
    severity: "warning",
    resolved: false,
    ...overrides,
  };
}

function makeChatSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    caseId: "case-1",
    moduleScope: "case",
    title: "测试会话",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeChatMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    sessionId: "session-1",
    caseId: "case-1",
    moduleScope: "case",
    role: "user",
    content: "你好",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFeedback(overrides: Record<string, unknown> = {}) {
  return {
    id: "fb-1",
    caseId: "case-1",
    subjectType: "claim-chart",
    subjectId: "chart-1",
    verdict: "like",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Case: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Case logic chain", () => {
  it("create → readById → readAll 验证", () => {
    const c = makeCase();
    dbCreate(db, "cases", c.id, c);

    const dbCase = dbGetById(db, "cases", "case-1");
    expect(dbCase).toBeDefined();
    expect(dbCase!.title).toBe("测试发明");
    expect(dbCase!.applicationNumber).toBe("CN2023100000001");

    const all = dbGetAll(db, "cases");
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("case-1");
  });

  it("update → readback 验证字段一致", () => {
    const c = makeCase();
    dbCreate(db, "cases", c.id, c);

    const updated = { ...c, title: "修改后的发明", workflowState: "claim-chart-ready" };
    dbUpdate(db, "cases", c.id, updated);

    const dbCase = dbGetById(db, "cases", "case-1");
    expect(dbCase!.title).toBe("修改后的发明");
    expect(dbCase!.workflowState).toBe("claim-chart-ready");
  });

  it("delete → readback 验证消失", () => {
    const c = makeCase();
    dbCreate(db, "cases", c.id, c);

    dbDelete(db, "cases", "case-1");

    const dbCase = dbGetById(db, "cases", "case-1");
    expect(dbCase).toBeNull();
    expect(dbGetAll(db, "cases")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Document: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Document logic chain", () => {
  it("create → readById 验证", () => {
    const doc = makeDoc();
    dbCreate(db, "documents", doc.id, doc);

    const dbDoc = dbGetById(db, "documents", "doc-1");
    expect(dbDoc).toBeDefined();
    expect(dbDoc!.fileName).toBe("申请文件.pdf");
    expect(dbDoc!.role).toBe("application");
  });

  it("update textStatus + extractedText → readback 验证", () => {
    const doc = makeDoc();
    dbCreate(db, "documents", doc.id, doc);

    dbUpdate(db, "documents", doc.id, { ...doc, textStatus: "confirmed", extractedText: "更新后的文本" });

    const dbDoc = dbGetById(db, "documents", "doc-1");
    expect(dbDoc!.textStatus).toBe("confirmed");
    expect(dbDoc!.extractedText).toBe("更新后的文本");
  });

  it("delete → readback 验证消失", () => {
    const doc = makeDoc();
    dbCreate(db, "documents", doc.id, doc);

    dbDelete(db, "documents", "doc-1");

    expect(dbGetById(db, "documents", "doc-1")).toBeNull();
  });

  it("query by caseId + role 过滤", () => {
    dbCreate(db, "documents", "doc-app", makeDoc({ id: "doc-app", role: "application" }));
    dbCreate(db, "documents", "doc-ref", makeDoc({ id: "doc-ref", role: "reference" }));

    const apps = dbQuery(db, "documents", "role", "application");
    expect(apps).toHaveLength(1);

    const refs = dbQuery(db, "documents", "role", "reference");
    expect(refs).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// ClaimNode + ClaimFeature: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Claim logic chain", () => {
  it("claimNode: create → readByCaseId 验证", () => {
    const node = makeClaimNode();
    dbCreate(db, "claimNodes", node.id, node);

    const dbNodes = dbQuery(db, "claimNodes", "caseId", "case-1");
    expect(dbNodes).toHaveLength(1);
    expect(dbNodes[0]!.rawText).toBe("一种装置，包括A和B");
    expect(dbNodes[0]!.type).toBe("independent");
  });

  it("claimNode: delete 后 DB 清空", () => {
    const node = makeClaimNode();
    dbCreate(db, "claimNodes", node.id, node);

    dbDelete(db, "claimNodes", "claim-1");

    expect(dbQuery(db, "claimNodes", "caseId", "case-1")).toHaveLength(0);
  });

  it("claimFeature: create → readByCaseId 验证", () => {
    const feature = makeClaimFeature();
    dbCreate(db, "claimCharts", feature.id, feature);

    const dbFeatures = dbQuery(db, "claimCharts", "caseId", "case-1");
    expect(dbFeatures).toHaveLength(1);
    expect(dbFeatures[0]!.featureCode).toBe("A");
    expect(dbFeatures[0]!.citationStatus).toBe("needs-review");
  });

  it("claimFeature: update citationStatus → readback 一致", () => {
    const feature = makeClaimFeature();
    dbCreate(db, "claimCharts", feature.id, feature);

    dbUpdate(db, "claimCharts", feature.id, { ...feature, citationStatus: "confirmed" });

    const dbFeatures = dbQuery(db, "claimCharts", "caseId", "case-1");
    expect(dbFeatures[0]!.citationStatus).toBe("confirmed");
  });
});

// ═══════════════════════════════════════════════════════════════
// Novelty: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Novelty logic chain", () => {
  it("create → readByCaseId 验证", () => {
    const n = makeNovelty();
    dbCreate(db, "novelty", n.id, n);

    const dbItems = dbQuery(db, "novelty", "caseId", "case-1");
    expect(dbItems).toHaveLength(1);
    expect(dbItems[0]!.referenceId).toBe("ref-1");
    expect(dbItems[0]!.rows).toHaveLength(1);
  });

  it("update rows + status → readback 一致", () => {
    const n = makeNovelty();
    dbCreate(db, "novelty", n.id, n);

    const updated = {
      ...n,
      rows: [
        ...n.rows,
        { featureCode: "B", disclosureStatus: "not-found", citations: [], mismatchNotes: "" },
      ],
      differenceFeatureCodes: ["B", "C"],
      status: "user-reviewed",
    };
    dbUpdate(db, "novelty", n.id, updated);

    const dbItems = dbQuery(db, "novelty", "caseId", "case-1");
    expect(dbItems[0]!.rows).toHaveLength(2);
    expect(dbItems[0]!.differenceFeatureCodes).toEqual(["B", "C"]);
    expect(dbItems[0]!.status).toBe("user-reviewed");
  });

  it("delete → readback 验证消失", () => {
    const n = makeNovelty();
    dbCreate(db, "novelty", n.id, n);

    dbDelete(db, "novelty", "novelty-1");

    expect(dbQuery(db, "novelty", "caseId", "case-1")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Inventive: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Inventive logic chain", () => {
  it("create → readByCaseId 验证", () => {
    const inv = makeInventive();
    dbCreate(db, "inventive", inv.id, inv);

    const dbItems = dbQuery(db, "inventive", "caseId", "case-1");
    expect(dbItems).toHaveLength(1);
    expect(dbItems[0]!.candidateAssessment).toBe("not-analyzed");
  });

  it("update motivationEvidence + objectiveTechnicalProblem → readback 一致", () => {
    const inv = makeInventive();
    dbCreate(db, "inventive", inv.id, inv);

    const updated = {
      ...inv,
      objectiveTechnicalProblem: "提高散热效率",
      motivationEvidence: [
        { documentId: "ref-2", label: "D2", confidence: "high" },
      ],
      closestPriorArtId: "ref-2",
    };
    dbUpdate(db, "inventive", inv.id, updated);

    const dbItems = dbQuery(db, "inventive", "caseId", "case-1");
    expect(dbItems[0]!.objectiveTechnicalProblem).toBe("提高散热效率");
    expect(dbItems[0]!.motivationEvidence).toHaveLength(1);
    expect(dbItems[0]!.closestPriorArtId).toBe("ref-2");
  });
});

// ═══════════════════════════════════════════════════════════════
// Defect: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Defect logic chain", () => {
  it("create → readByCaseId 验证", () => {
    const d = makeDefect();
    dbCreate(db, "defects", d.id, d);

    const dbDefects = dbQuery(db, "defects", "caseId", "case-1");
    expect(dbDefects).toHaveLength(1);
    expect(dbDefects[0]!.category).toBe("权利要求");
    expect(dbDefects[0]!.severity).toBe("warning");
  });

  it("update description + severity → readback 一致", () => {
    const d = makeDefect();
    dbCreate(db, "defects", d.id, d);

    dbUpdate(db, "defects", d.id, { ...d, description: "修改后的描述", severity: "error" });

    const dbDefects = dbQuery(db, "defects", "caseId", "case-1");
    expect(dbDefects[0]!.description).toBe("修改后的描述");
    expect(dbDefects[0]!.severity).toBe("error");
  });

  it("delete → readback 验证消失", () => {
    const d = makeDefect();
    dbCreate(db, "defects", d.id, d);

    dbDelete(db, "defects", "defect-1");

    expect(dbQuery(db, "defects", "caseId", "case-1")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Chat: Session + Message CRUD + cascade
// ═══════════════════════════════════════════════════════════════

describe("Chat logic chain", () => {
  it("session: create → readByCaseId 验证", () => {
    const session = makeChatSession();
    dbCreate(db, "chatSessions", session.id, session);

    const dbSessions = dbQuery(db, "chatSessions", "caseId", "case-1");
    expect(dbSessions).toHaveLength(1);
    expect(dbSessions[0]!.title).toBe("测试会话");
  });

  it("message: create → readBySessionId 验证", () => {
    dbCreate(db, "chatSessions", "session-1", makeChatSession());
    const msg = makeChatMessage();
    dbCreate(db, "chatMessages", msg.id, msg);

    const dbMessages = dbQuery(db, "chatMessages", "sessionId", "session-1");
    expect(dbMessages).toHaveLength(1);
    expect(dbMessages[0]!.role).toBe("user");
    expect(dbMessages[0]!.content).toBe("你好");
  });

  it("cascade: 删除 session → messages 手动清除", () => {
    dbCreate(db, "chatSessions", "session-1", makeChatSession());
    dbCreate(db, "chatMessages", "msg-1", makeChatMessage());

    // 级联清理（应用层负责）
    const messages = dbQuery(db, "chatMessages", "sessionId", "session-1");
    for (const m of messages) {
      dbDelete(db, "chatMessages", m.id);
    }
    dbDelete(db, "chatSessions", "session-1");

    expect(dbQuery(db, "chatSessions", "caseId", "case-1")).toHaveLength(0);
    expect(dbQuery(db, "chatMessages", "sessionId", "session-1")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Feedback: Create → Read → Update → Delete
// ═══════════════════════════════════════════════════════════════

describe("Feedback logic chain", () => {
  it("create → read → update → delete 全生命周期", () => {
    const fb = makeFeedback();
    dbCreate(db, "feedback", fb.id, fb);

    let all = dbQuery(db, "feedback", "caseId", "case-1");
    expect(all).toHaveLength(1);
    expect(all[0]!.verdict).toBe("like");

    dbUpdate(db, "feedback", fb.id, { ...fb, verdict: "dislike" });
    all = dbQuery(db, "feedback", "caseId", "case-1");
    expect(all[0]!.verdict).toBe("dislike");

    dbDelete(db, "feedback", "fb-1");
    all = dbQuery(db, "feedback", "caseId", "case-1");
    expect(all).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Settings: Write → Read → Update
// ═══════════════════════════════════════════════════════════════

describe("Settings logic chain", () => {
  it("write → read → update → readback 验证", () => {
    const settings = {
      mode: "mock",
      guidelineVersion: "2023",
      providers: [],
      agents: [],
      persistKeysEncrypted: false,
    };
    dbCreate(db, "settings", "app", settings);

    const stored = dbGetById(db, "settings", "app");
    expect(stored!.mode).toBe("mock");

    dbUpdate(db, "settings", "app", { ...settings, mode: "real", guidelineVersion: "2024" });

    const updated = dbGetById(db, "settings", "app");
    expect(updated!.mode).toBe("real");
    expect(updated!.guidelineVersion).toBe("2024");
  });
});
