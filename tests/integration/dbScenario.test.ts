/**
 * DB Scenario Regression Tests — B-042: 测试数据库隔离机制
 *
 * 针对已修复bug的回归测试，确保 Database CRUD 问题不复现：
 *   Bug 18: 删除对比文件后无法再加载再比较
 *   Bug 19: Store 状态与 DB 不一致（级联清理未同步）
 *   Bug 21: 数据保存后读取不一致
 *   Bug 22: 缺陷数据保存后丢失/不更新
 *
 * B-038 后数据层从 IndexedDB 迁移到 SQLite。
 * 使用内存数据库隔离，直接测试 sync_data CRUD 操作。
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

const CASE_ID = "bug-test-case";

beforeEach(() => {
  tdb = createMemoryDb();
  db = tdb.db;
});

afterEach(() => {
  tdb.cleanup();
});

// ══════════════════════════════════════════════════════════════════════
// Helper factories
// ══════════════════════════════════════════════════════════════════════

function makeCase() {
  return {
    id: CASE_ID,
    applicationNumber: "CN2023100000000",
    title: "回归测试发明",
    applicationDate: "2023-01-01",
    patentType: "invention",
    textVersion: "original",
    targetClaimNumber: 1,
    guidelineVersion: "2023",
    reexaminationRound: 1,
    workflowState: "empty",
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  };
}

function makeReference(refId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: refId,
    caseId: CASE_ID,
    role: "reference",
    fileName: `对比文件-${refId}.pdf`,
    fileType: "pdf",
    textStatus: "extracted",
    extractedText: "内容...",
    textIndex: { pages: [], paragraphs: [], lineMap: [] },
    createdAt: "2023-01-01T00:00:00.000Z",
    timelineStatus: "available",
    publicationDateConfidence: "high",
    ...overrides,
  };
}

function makeNovelty(refId: string) {
  return {
    id: `novelty-${refId}`,
    caseId: CASE_ID,
    referenceId: refId,
    claimNumber: 1,
    rows: [
      { featureCode: "A", disclosureStatus: "clearly-disclosed", citations: [], mismatchNotes: "" },
    ],
    differenceFeatureCodes: ["B"],
    pendingSearchQuestions: [],
    status: "draft",
    legalCaution: "候选事实整理，不构成法律结论。",
  };
}

// ══════════════════════════════════════════════════════════════════════
// Bug 18: 删除对比文件后无法再加载再比较
// ══════════════════════════════════════════════════════════════════════

describe("Bug 18 Regression: Delete reference and reload", () => {
  it("删除对比文件 A → 验证 DB 均消失 → 重新添加对比文件 A → 可正常加载", () => {
    dbCreate(db, "cases", CASE_ID, makeCase());
    const refA = makeReference("ref-A");
    dbCreate(db, "documents", refA.id, refA);

    let dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(1);
    expect(dbRefs[0]!.id).toBe("ref-A");

    dbDelete(db, "documents", "ref-A");

    dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(0);

    // 重新添加同 ID 的对比文件
    const refA2 = makeReference("ref-A");
    dbCreate(db, "documents", refA2.id, refA2);

    dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(1);
    expect(dbRefs[0]!.id).toBe("ref-A");
  });

  it("删除对比文件后 → 关联的新颖性对照应可独立操作", () => {
    dbCreate(db, "cases", CASE_ID, makeCase());
    dbCreate(db, "documents", "ref-A", makeReference("ref-A"));
    dbCreate(db, "documents", "ref-B", makeReference("ref-B"));

    const novA = makeNovelty("ref-A");
    const novB = makeNovelty("ref-B");
    dbCreate(db, "novelty", novA.id, novA);
    dbCreate(db, "novelty", novB.id, novB);

    dbDelete(db, "documents", "ref-A");

    const dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(1);
    expect(dbRefs[0]!.id).toBe("ref-B");

    // 新颖性对照仍然存在（未级联删除）
    const dbNovelties = dbQuery(db, "novelty", "caseId", CASE_ID);
    expect(dbNovelties).toHaveLength(2);
  });

  it("多次删除-重建循环后 DB 保持一致", () => {
    dbCreate(db, "cases", CASE_ID, makeCase());

    for (let i = 1; i <= 3; i++) {
      const ref = makeReference("ref-cycle");
      dbCreate(db, "documents", ref.id, ref);

      let dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
      expect(dbRefs).toHaveLength(1);

      dbDelete(db, "documents", "ref-cycle");

      dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
      expect(dbRefs).toHaveLength(0);
    }

    const ref = makeReference("ref-cycle");
    dbCreate(db, "documents", ref.id, ref);
    const dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Bug 19: Store 状态与 DB 不一致（级联清理未同步）
// ══════════════════════════════════════════════════════════════════════

describe("Bug 19 Regression: Cascade cleanup sync", () => {
  it("删除 Case → 相关 Chat sessions/messages 应在 DB 中清除", () => {
    dbCreate(db, "cases", CASE_ID, makeCase());
    dbCreate(db, "chatSessions", "session-1", {
      id: "session-1", caseId: CASE_ID, moduleScope: "case",
      title: "测试会话", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    dbCreate(db, "chatMessages", "msg-1", {
      id: "msg-1", sessionId: "session-1", caseId: CASE_ID, moduleScope: "case",
      role: "user", content: "你好", createdAt: new Date().toISOString(),
    });

    // 级联清理
    dbDelete(db, "chatMessages", "msg-1");
    dbDelete(db, "chatSessions", "session-1");
    dbDelete(db, "cases", CASE_ID);

    expect(dbQuery(db, "chatSessions", "caseId", CASE_ID)).toHaveLength(0);
    expect(dbQuery(db, "chatMessages", "sessionId", "session-1")).toHaveLength(0);
    expect(dbGetById(db, "cases", CASE_ID)).toBeNull();
  });

  it("级联操作后重新创建同 ID 的实体不冲突", () => {
    dbCreate(db, "cases", CASE_ID, makeCase());
    dbDelete(db, "cases", CASE_ID);

    const c2 = makeCase();
    dbCreate(db, "cases", CASE_ID, c2);

    const dbCase = dbGetById(db, "cases", CASE_ID);
    expect(dbCase).toBeDefined();
    expect(dbCase!.title).toBe("回归测试发明");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Bug 21: 数据保存后读取不一致
// ══════════════════════════════════════════════════════════════════════

describe("Bug 21 Regression: Save then readback consistency", () => {
  it("写入 Case 所有字段 → DB 读回 → 字段一一匹配", () => {
    const c = makeCase();
    dbCreate(db, "cases", c.id, c);

    const updated = {
      ...c,
      title: "修改后的标题",
      workflowState: "documents-uploaded",
      examinerNotes: "审查员备注信息",
      reexaminationRound: 2,
    };
    dbUpdate(db, "cases", c.id, updated);

    const dbCase = dbGetById(db, "cases", CASE_ID);
    expect(dbCase!.title).toBe("修改后的标题");
    expect(dbCase!.workflowState).toBe("documents-uploaded");
    expect(dbCase!.examinerNotes).toBe("审查员备注信息");
    expect(dbCase!.reexaminationRound).toBe(2);
  });

  it("Reference 字段完整性：所有字段写回读回一致", () => {
    const ref = makeReference("ref-full", {
      title: "LED散热装置对比文献",
      publicationNumber: "CN112345678A",
      publicationDate: "2021-01-15",
      technicalField: "散热器技术领域",
      summary: "公开了一种散热结构",
      relevanceNotes: "与本申请相关",
    });
    dbCreate(db, "documents", ref.id, ref);

    const dbRefs = dbQuery(db, "documents", "caseId", CASE_ID).filter(r => r.role === "reference");
    expect(dbRefs).toHaveLength(1);
    expect(dbRefs[0]!.publicationNumber).toBe("CN112345678A");
    expect(dbRefs[0]!.title).toBe("LED散热装置对比文献");
  });

  it("Novelty rows 复杂对象写回读回一致性", () => {
    const novelty = {
      id: "novelty-complex",
      caseId: CASE_ID,
      referenceId: "ref-complex",
      claimNumber: 1,
      rows: [
        {
          featureCode: "A",
          disclosureStatus: "clearly-disclosed",
          citations: [
            { documentId: "ref-complex", label: "D1", paragraph: "[0008]", quote: "散热翅片与基板连接", confidence: "high" },
          ],
        },
        {
          featureCode: "B",
          disclosureStatus: "not-found",
          citations: [],
        },
      ],
      differenceFeatureCodes: ["B"],
      pendingSearchQuestions: ["散热效率相关文献"],
      status: "draft",
      legalCaution: "候选事实，不构成法律结论。",
    };
    dbCreate(db, "novelty", novelty.id, novelty);

    const dbItems = dbQuery(db, "novelty", "caseId", CASE_ID);
    expect(dbItems).toHaveLength(1);
    expect(dbItems[0]!.rows).toHaveLength(2);

    const row0 = dbItems[0]!.rows[0];
    expect(row0.featureCode).toBe("A");
    expect(row0.disclosureStatus).toBe("clearly-disclosed");
    expect(row0.citations).toHaveLength(1);
    expect(row0.citations[0].quote).toBe("散热翅片与基板连接");
    expect(row0.citations[0].confidence).toBe("high");

    const row1 = dbItems[0]!.rows[1];
    expect(row1.featureCode).toBe("B");
    expect(row1.disclosureStatus).toBe("not-found");

    expect(dbItems[0]!.pendingSearchQuestions).toEqual(["散热效率相关文献"]);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Bug 22: 缺陷数据保存后丢失/不更新
// ══════════════════════════════════════════════════════════════════════

describe("Bug 22 Regression: Defect CRUD integrity", () => {
  it("创建缺陷 → DB 写入 → 读回验证", () => {
    const defect = {
      id: "defect-bug22-1",
      caseId: CASE_ID,
      category: "权利要求",
      description: "权利要求1不清楚，缺少对技术效果的限定",
      severity: "warning",
      resolved: false,
    };
    dbCreate(db, "defects", defect.id, defect);

    const dbDefects = dbQuery(db, "defects", "caseId", CASE_ID);
    expect(dbDefects).toHaveLength(1);
    expect(dbDefects[0]!.id).toBe("defect-bug22-1");
    expect(dbDefects[0]!.description).toBe("权利要求1不清楚，缺少对技术效果的限定");
    expect(dbDefects[0]!.severity).toBe("warning");
    expect(dbDefects[0]!.resolved).toBe(false);
  });

  it("更新缺陷 → DB 同步（描述、严重性、解决状态均更新）", () => {
    const defect = {
      id: "defect-bug22-2",
      caseId: CASE_ID,
      category: "说明书",
      description: "说明书第3页存在笔误",
      severity: "info",
      resolved: false,
    };
    dbCreate(db, "defects", defect.id, defect);

    dbUpdate(db, "defects", defect.id, {
      ...defect,
      description: "说明书第3页存在笔误 (已更正)",
      severity: "error",
      resolved: true,
    });

    const dbDefects = dbQuery(db, "defects", "caseId", CASE_ID);
    expect(dbDefects).toHaveLength(1);
    expect(dbDefects[0]!.description).toBe("说明书第3页存在笔误 (已更正)");
    expect(dbDefects[0]!.severity).toBe("error");
    expect(dbDefects[0]!.resolved).toBe(true);
  });

  it("批量缺陷：创建多个 → 删一个 → 其余仍在", () => {
    for (let i = 1; i <= 5; i++) {
      dbCreate(db, "defects", `defect-bug22-${i}`, {
        id: `defect-bug22-${i}`,
        caseId: CASE_ID,
        category: "权利要求",
        description: `缺陷描述 ${i}`,
        severity: "warning",
        resolved: false,
      });
    }

    expect(dbQuery(db, "defects", "caseId", CASE_ID)).toHaveLength(5);

    dbDelete(db, "defects", "defect-bug22-3");

    const remaining = dbQuery(db, "defects", "caseId", CASE_ID);
    expect(remaining).toHaveLength(4);
    expect(remaining.find(d => d.id === "defect-bug22-3")).toBeUndefined();
    expect(remaining.find(d => d.id === "defect-bug22-1")).toBeDefined();
    expect(remaining.find(d => d.id === "defect-bug22-5")).toBeDefined();
  });
});
