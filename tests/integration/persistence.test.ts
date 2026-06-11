/**
 * 全场景持久化自动测试 — FEAT-043
 * ===================================
 *
 * 覆盖：§一 Settings 全字段持久化、§二 全 Store CRUD、§三 复杂嵌套对象、
 *       §四 边界场景、§六.1 HTTP 全链路 Round-Trip
 *
 * 运行：vitest run --config vitest.integration.config.ts tests/integration/persistence.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  createMemoryDb,
  dbCreate,
  dbGetById,
  dbGetAll,
  dbQuery,
  dbUpdate,
  dbDelete,
  dbClearAll,
  type TestDb,
} from "../helpers/testDb.js";
import { resetSyncDbForTesting } from "@server/lib/syncDb.js";

// ══════════════════════════════════════════════════════════════════════
// §一 测试数据 — 完整 AppSettings 对象
// ══════════════════════════════════════════════════════════════════════

const FULL_SETTINGS = {
  id: "app",
  mode: "real",
  guidelineVersion: "2023",
  providers: [
    {
      providerId: "mimo",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      apiKeyRef: "sk-mimo-test-key-12345",
      modelIds: ["mimo-v2.5-pro", "mimo-v2.5"],
      defaultModelId: "mimo-v2.5-pro",
      modelFallbacks: ["mimo-v2.5-pro", "mimo-v2.5"],
      enabled: true,
      enableModelFallback: true,
    },
    {
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyRef: "sk-deepseek-test-key-12345",
      modelIds: ["deepseek-chat", "deepseek-reasoner"],
      defaultModelId: "deepseek-chat",
      enabled: false,
      enableModelFallback: false,
    },
  ],
  agents: [
    { agent: "interpret", providerOrder: ["mimo"], modelId: "mimo-v2.5-pro", maxTokens: 4096 },
    { agent: "claim-chart", providerOrder: ["mimo", "deepseek"], modelId: "mimo-v2.5-pro", maxTokens: 8192, reasoningLevel: "high" },
    { agent: "novelty", providerOrder: [], modelId: "", maxTokens: 4096 },
    { agent: "inventive", providerOrder: ["deepseek"], modelId: "deepseek-reasoner", maxTokens: 16384, reasoningLevel: "high" },
    { agent: "summary", providerOrder: [], modelId: "", maxTokens: 4096 },
    { agent: "chat", providerOrder: ["mimo"], modelId: "mimo-v2.5-pro", maxTokens: 4096 },
    { agent: "draft", providerOrder: [], modelId: "", maxTokens: 1500 },
    { agent: "opinion-analysis", providerOrder: ["mimo"], modelId: "mimo-v2.5-pro", maxTokens: 4096 },
    { agent: "argument-analysis", providerOrder: ["mimo"], modelId: "mimo-v2.5-pro", maxTokens: 4096 },
    { agent: "reexam-draft", providerOrder: ["mimo"], modelId: "mimo-v2.5-pro", maxTokens: 4096 },
  ],
  searchProviders: [
    { providerId: "tavily", name: "Tavily", apiKeyRef: "tvly-dev-abc123def456", enabled: true },
    { providerId: "serpapi", name: "SerpAPI", apiKeyRef: "serpapi-key-789", baseUrl: "https://serpapi.com/search", enabled: false },
    { providerId: "epo", name: "EPO OPS", apiKeyRef: "epo-consumer:epo-secret", enabled: true },
  ],
  enableProviderFallback: true,
  providerErrorMessages: [
    {
      id: "err-001",
      providerId: "mimo",
      errorCode: "quota-exceeded",
      message: "Quota exceeded for MiMo API",
      timestamp: "2026-06-04T10:00:00.000Z",
      read: false,
      agent: "novelty",
      caseId: "case-123",
    },
    {
      id: "err-002",
      providerId: "deepseek",
      errorCode: "rate-limited",
      message: "Rate limit exceeded",
      timestamp: "2026-06-04T11:00:00.000Z",
      read: true,
      agent: "claim-chart",
      caseId: "case-456",
    },
  ],
  knowledge: {
    enabled: true,
    topK: 10,
    scoreThreshold: 0.5,
  },
  knowledgeProviders: [
    {
      providerType: "embedding",
      providerId: "siliconflow",
      displayName: "硅基流动 Embedding",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKeyRef: "sk-siliconflow-embedding-key",
      modelId: "BAAI/bge-m3",
      availableModels: ["BAAI/bge-m3", "BAAI/bge-large-zh"],
      enabled: true,
    },
    {
      providerType: "reranker",
      providerId: "siliconflow",
      displayName: "硅基流动 Re-ranker",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKeyRef: "sk-siliconflow-reranker-key-different",
      modelId: "BAAI/bge-reranker-v2-m3",
      availableModels: [],
      enabled: true,
    },
  ],
  sanitizeRules: [
    { pattern: "\\s+", replace: " ", note: "合并空白" },
  ],
  ocrQualityThresholds: { good: 0.70, poor: 0.40 },
};

// ══════════════════════════════════════════════════════════════════════
// §二 全 Store CRUD 测试数据
// ══════════════════════════════════════════════════════════════════════

const SAMPLE_CASE = {
  applicationNumber: "CN202310001001A",
  title: "一种LED灯具用复合散热装置",
  applicant: "测试申请人",
  applicationDate: "2023-03-15",
  priorityDate: "",
  targetClaimNumber: 1,
  textVersion: "original",
  patentType: "invention",
  workflowState: "case-ready",
  examinerNotes: "测试备注",
  createdAt: "2026-06-04T10:00:00.000Z",
  updatedAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_DOCUMENT = {
  caseId: "case-1",
  role: "application",
  fileName: "申请文件.pdf",
  fileType: "pdf",
  textLayerStatus: "present",
  ocrStatus: "none",
  extractedText: "一种LED灯具用复合散热装置...",
  fileHash: "abc123",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_CLAIM_NODE = {
  caseId: "case-1",
  claimNumber: 1,
  type: "independent",
  dependsOn: [],
  rawText: "一种LED灯具用复合散热装置，其特征在于，包括：散热基板...",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_CLAIM_CHART = {
  caseId: "case-1",
  claimNumber: 1,
  featureCode: "A",
  description: "散热基板，由铝合金材料制成",
  specificationCitations: [
    { label: "说明书第001段", paragraph: "1", quote: "散热基板由铝合金制成", confidence: "high" },
    { label: "说明书第002段", paragraph: "2", quote: "表面设有散热翅片", confidence: "medium" },
  ],
  citationStatus: "confirmed",
  reviewerNotes: "",
  source: "ai",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_NOVELTY = {
  caseId: "case-1",
  referenceId: "ref-d1",
  claimNumber: 1,
  status: "user-reviewed",
  rows: [
    {
      featureCode: "A",
      disclosureStatus: "clearly-disclosed",
      citations: [
        { documentId: "ref-d1", label: "D1 §0023", paragraph: "23", quote: "铝合金散热基板", confidence: "high" },
      ],
      reviewerNotes: "",
    },
    {
      featureCode: "B",
      disclosureStatus: "not-found",
      citations: [],
      reviewerNotes: "可能区别特征",
    },
  ],
  differenceFeatureCodes: ["B", "C"],
  pendingSearchQuestions: ["石墨烯导热膜的厚度参数"],
  createdAt: "2026-06-04T10:00:00.000Z",
  updatedAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_INVENTIVE = {
  caseId: "case-1",
  closestPriorArtId: "ref-d1",
  commonFeatures: ["A"],
  differenceFeatures: ["B", "C"],
  actualTechnicalProblem: "提高散热效率",
  technical启示Evidence: [],
  features: [
    { featureCode: "B", analysis: "石墨烯导热膜未在D1中公开", conclusion: "possibly-inventive" },
  ],
  overallConclusion: "possibly-lacks-inventiveness",
  candidateAssessment: "possibly-lacks-inventiveness",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_DEFECT = {
  caseId: "case-1",
  category: "support",
  description: "权利要求3的1h-168h范围仅有24h一个实施例支持",
  severity: "warning",
  resolved: false,
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_CHAT_SESSION = {
  caseId: "case-1",
  title: "文档解读对话",
  createdAt: "2026-06-04T10:00:00.000Z",
  updatedAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_CHAT_MESSAGE = {
  sessionId: "session-1",
  caseId: "case-1",
  moduleScope: "case",
  role: "user",
  content: "这个技术方案的核心创新在哪？",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_OPINION_ANALYSIS = {
  caseId: "case-1",
  analysisData: {
    rejectionGrounds: [
      { groundType: "novelty", claimNumbers: [1], citedReferences: ["D1"], reasoning: "..." },
    ],
  },
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_ARGUMENT_MAPPING = {
  caseId: "case-1",
  claimFeature: "A",
  argument: "申请人认为D1未公开特征A",
  aiSummary: "申请人对新颖性提出异议",
  confidence: "medium",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_INTERPRET_SUMMARIES = {
  caseId: "case-1",
  summaries: {
    "doc-app-1": "本申请涉及一种LED灯具散热装置，核心技术方案包括...",
    "doc-ref-d1": "D1公开了一种铝合金散热基板，但未涉及石墨烯导热膜...",
  },
};

const SAMPLE_REEXAM_DRAFT = {
  caseId: "case-1",
  responseItems: [
    { rejectionId: "R1", response: "针对驳回理由1的回应..." },
  ],
  overallAssessment: "建议维持驳回",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_SUMMARY = {
  caseId: "case-1",
  body: "本申请涉及一种LED灯具散热装置...",
  aiNotes: "AI备注内容",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_RUN_MARKER = {
  caseId: "case-1",
  module: "claimChart",
  createdAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_SEARCH_SESSION = {
  caseId: "case-1",
  queries: ["LED散热 石墨烯"],
  results: [{ provider: "tavily", count: 5 }],
  updatedAt: "2026-06-04T10:00:00.000Z",
};

const SAMPLE_TEXT_INDEX = {
  documentId: "doc-1",
  pages: [
    { pageNumber: 1, text: "第一页内容..." },
    { pageNumber: 2, text: "第二页内容..." },
  ],
  paragraphs: [
    { number: "1", text: "一种LED灯具用复合散热装置", page: 1 },
    { number: "2", text: "散热基板由铝合金制成", page: 1 },
  ],
  lineMap: { "1": { start: 0, end: 50 }, "2": { start: 51, end: 100 } },
};

// ══════════════════════════════════════════════════════════════════════
// 所有 Store 名称列表（与 DESIGN.md §11 一致）
// ══════════════════════════════════════════════════════════════════════

const ALL_STORES = [
  "cases", "documents", "claimNodes", "claimCharts", "novelty",
  "inventive", "chatMessages", "settings", "textIndex",
  "ocrCache", "interpretSummaries", "defects", "chatSessions",
  "opinionAnalyses", "argumentMappings", "reexamDrafts", "summaries",
  "runMarkers", "searchSessions",
];

// ══════════════════════════════════════════════════════════════════════
// §一 Settings 全字段持久化
// ══════════════════════════════════════════════════════════════════════

describe("§一 Settings 全字段持久化", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMemoryDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("TC-1.1: 写入完整 settings → 读回 → 逐字段 deepEqual", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);
    const readback = dbGetById(testDb.db, "settings", "app");

    expect(readback).not.toBeNull();
    expect(readback!.mode).toBe("real");
    expect(readback!.guidelineVersion).toBe("2023");
    expect(readback!.providers).toEqual(FULL_SETTINGS.providers);
    expect(readback!.agents).toEqual(FULL_SETTINGS.agents);
    expect(readback!.searchProviders).toEqual(FULL_SETTINGS.searchProviders);
    expect(readback!.enableProviderFallback).toBe(true);
    expect(readback!.providerErrorMessages).toEqual(FULL_SETTINGS.providerErrorMessages);
    expect(readback!.knowledge).toEqual(FULL_SETTINGS.knowledge);
    expect(readback!.knowledgeProviders).toEqual(FULL_SETTINGS.knowledgeProviders);
    expect(readback!.sanitizeRules).toEqual(FULL_SETTINGS.sanitizeRules);
    expect(readback!.ocrQualityThresholds).toEqual(FULL_SETTINGS.ocrQualityThresholds);
  });

  it("TC-1.2: 写入 → 新建内存 DB → 再次写入 → 读回", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);

    // 模拟"重启"：创建新 DB 并写入相同数据
    const testDb2 = createMemoryDb();
    dbCreate(testDb2.db, "settings", "app", FULL_SETTINGS);
    const readback = dbGetById(testDb2.db, "settings", "app");

    expect(readback).not.toBeNull();
    expect(readback!.providers).toEqual(FULL_SETTINGS.providers);
    testDb2.cleanup();
  });

  it("TC-1.3: 局部更新 mimo provider → deepseek provider 不变", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);

    // 局部更新：修改 mimo 的 apiKeyRef
    const updated = {
      ...FULL_SETTINGS,
      providers: FULL_SETTINGS.providers.map((p) =>
        p.providerId === "mimo" ? { ...p, apiKeyRef: "sk-new-mimo-key" } : p
      ),
    };
    dbCreate(testDb.db, "settings", "app", updated);

    const readback = dbGetById(testDb.db, "settings", "app");
    const mimo = (readback!.providers as Array<Record<string, unknown>>).find((p) => p.providerId === "mimo");
    const deepseek = (readback!.providers as Array<Record<string, unknown>>).find((p) => p.providerId === "deepseek");

    expect(mimo!.apiKeyRef).toBe("sk-new-mimo-key");
    expect(deepseek!.apiKeyRef).toBe("sk-deepseek-test-key-12345");
  });

  it("TC-1.4: 空 providers: [] → 读回为空数组", () => {
    const settings = { ...FULL_SETTINGS, providers: [] };
    dbCreate(testDb.db, "settings", "app", settings);
    const readback = dbGetById(testDb.db, "settings", "app");
    expect(readback!.providers).toEqual([]);
    expect(Array.isArray(readback!.providers)).toBe(true);
  });

  it("TC-1.5: enableProviderFallback: false → 读回为 false", () => {
    const settings = { ...FULL_SETTINGS, enableProviderFallback: false };
    dbCreate(testDb.db, "settings", "app", settings);
    const readback = dbGetById(testDb.db, "settings", "app");
    expect(readback!.enableProviderFallback).toBe(false);
  });

  it("TC-1.6: 不含 knowledge 字段 → 读回为 undefined", () => {
    const { knowledge: _knowledge, ...settingsWithoutKnowledge } = FULL_SETTINGS;
    dbCreate(testDb.db, "settings", "app", settingsWithoutKnowledge);
    const readback = dbGetById(testDb.db, "settings", "app");
    expect(readback!.knowledge).toBeUndefined();
  });

  it("TC-1.7: 不含 knowledgeProviders 字段 → 读回为 undefined", () => {
    const { knowledgeProviders: _kp, ...settingsWithoutKP } = FULL_SETTINGS;
    dbCreate(testDb.db, "settings", "app", settingsWithoutKP);
    const readback = dbGetById(testDb.db, "settings", "app");
    expect(readback!.knowledgeProviders).toBeUndefined();
  });

  it("TC-1.8: EPO key 含冒号 key:secret → 完整保留", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);
    const readback = dbGetById(testDb.db, "settings", "app");
    const epo = (readback!.searchProviders as Array<Record<string, unknown>>).find((p) => p.providerId === "epo");
    expect(epo!.apiKeyRef).toBe("epo-consumer:epo-secret");
  });

  it("TC-1.9: providerErrorMessages 含 50 条 → 数量和内容一致", () => {
    const errors = Array.from({ length: 50 }, (_, i) => ({
      id: `err-${String(i).padStart(3, "0")}`,
      providerId: i % 2 === 0 ? "mimo" : "deepseek",
      errorCode: i % 3 === 0 ? "quota-exceeded" : "rate-limited",
      message: `Error message ${i}`,
      timestamp: new Date(2026, 5, 4, 10, i).toISOString(),
      read: i % 5 === 0,
      agent: "novelty",
      caseId: `case-${i}`,
    }));
    const settings = { ...FULL_SETTINGS, providerErrorMessages: errors };
    dbCreate(testDb.db, "settings", "app", settings);
    const readback = dbGetById(testDb.db, "settings", "app");
    expect((readback!.providerErrorMessages as unknown[]).length).toBe(50);
    expect((readback!.providerErrorMessages as Array<Record<string, unknown>>)[0]!.id).toBe("err-000");
    expect((readback!.providerErrorMessages as Array<Record<string, unknown>>)[49]!.id).toBe("err-049");
  });

  it("TC-1.10: knowledgeProviders 同 providerId 不同 providerType → 各自独立保留", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);
    const readback = dbGetById(testDb.db, "settings", "app");
    const kps = readback!.knowledgeProviders as Array<Record<string, unknown>>;
    expect(kps.length).toBe(2);
    expect(kps[0]!.providerType).toBe("embedding");
    expect(kps[1]!.providerType).toBe("reranker");
    expect(kps[0]!.apiKeyRef).toBe("sk-siliconflow-embedding-key");
    expect(kps[1]!.apiKeyRef).toBe("sk-siliconflow-reranker-key-different");
  });
});

// ══════════════════════════════════════════════════════════════════════
// §二 全 Store CRUD 持久化
// ══════════════════════════════════════════════════════════════════════

describe("§二 全 Store CRUD 持久化", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMemoryDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe("cases", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
      const r = dbGetById(testDb.db, "cases", "case-1");
      expect(r).not.toBeNull();
      expect(r!.applicationNumber).toBe("CN202310001001A");
      expect(r!.title).toBe("一种LED灯具用复合散热装置");
      expect(r!.workflowState).toBe("case-ready");
    });
    it("Update → GetById → 更新生效", () => {
      dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
      dbUpdate(testDb.db, "cases", "case-1", { ...SAMPLE_CASE, workflowState: "text-confirmed" });
      const r = dbGetById(testDb.db, "cases", "case-1");
      expect(r!.workflowState).toBe("text-confirmed");
    });
    it("Delete → GetById → 返回 null", () => {
      dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
      dbDelete(testDb.db, "cases", "case-1");
      expect(dbGetById(testDb.db, "cases", "case-1")).toBeNull();
    });
    it("Query by applicationNumber → 过滤正确", () => {
      dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
      dbCreate(testDb.db, "cases", "case-2", { ...SAMPLE_CASE, applicationNumber: "CN202310002002A", title: "另一个案件" });
      const results = dbQuery(testDb.db, "cases", "applicationNumber", "CN202310001001A");
      expect(results.length).toBe(1);
    });
  });

  describe("documents", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "documents", "doc-1", SAMPLE_DOCUMENT);
      const r = dbGetById(testDb.db, "documents", "doc-1");
      expect(r).not.toBeNull();
      expect(r!.role).toBe("application");
      expect(r!.fileName).toBe("申请文件.pdf");
    });
    it("Query by role → reference vs application", () => {
      dbCreate(testDb.db, "documents", "doc-1", SAMPLE_DOCUMENT);
      dbCreate(testDb.db, "documents", "doc-2", { ...SAMPLE_DOCUMENT, role: "reference", fileName: "D1.pdf" });
      const refs = dbQuery(testDb.db, "documents", "role", "reference");
      expect(refs.length).toBe(1);
      expect(refs[0]!.fileName).toBe("D1.pdf");
    });
  });

  describe("claimNodes", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "claimNodes", "cn-1", SAMPLE_CLAIM_NODE);
      const r = dbGetById(testDb.db, "claimNodes", "cn-1");
      expect(r!.claimNumber).toBe(1);
      expect(r!.type).toBe("independent");
    });
  });

  describe("claimCharts", () => {
    it("Create → GetById → 嵌套 citation 数组完整", () => {
      dbCreate(testDb.db, "claimCharts", "cc-1", SAMPLE_CLAIM_CHART);
      const r = dbGetById(testDb.db, "claimCharts", "cc-1");
      expect(r!.featureCode).toBe("A");
      expect((r!.specificationCitations as unknown[]).length).toBe(2);
      expect((r!.specificationCitations as Array<Record<string, unknown>>)[0]!.confidence).toBe("high");
    });
    it("Query by caseId", () => {
      dbCreate(testDb.db, "claimCharts", "cc-1", SAMPLE_CLAIM_CHART);
      dbCreate(testDb.db, "claimCharts", "cc-2", { ...SAMPLE_CLAIM_CHART, featureCode: "B" });
      const results = dbQuery(testDb.db, "claimCharts", "caseId", "case-1");
      expect(results.length).toBe(2);
    });
  });

  describe("novelty", () => {
    it("Create → GetById → 深嵌套 rows 完整", () => {
      dbCreate(testDb.db, "novelty", "nov-1", SAMPLE_NOVELTY);
      const r = dbGetById(testDb.db, "novelty", "nov-1");
      expect(r!.status).toBe("user-reviewed");
      expect((r!.rows as unknown[]).length).toBe(2);
      const row0 = (r!.rows as Array<Record<string, unknown>>)[0]!;
      expect(row0.disclosureStatus).toBe("clearly-disclosed");
      expect((row0.citations as unknown[]).length).toBe(1);
    });
  });

  describe("inventive", () => {
    it("Create → GetById → 复杂对象完整", () => {
      dbCreate(testDb.db, "inventive", "inv-1", SAMPLE_INVENTIVE);
      const r = dbGetById(testDb.db, "inventive", "inv-1");
      expect(r!.closestPriorArtId).toBe("ref-d1");
      expect(r!.overallConclusion).toBe("possibly-lacks-inventiveness");
      expect((r!.features as unknown[]).length).toBe(1);
    });
  });

  describe("defects", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "defects", "def-1", SAMPLE_DEFECT);
      const r = dbGetById(testDb.db, "defects", "def-1");
      expect(r!.category).toBe("support");
      expect(r!.severity).toBe("warning");
      expect(r!.resolved).toBe(false);
    });
    it("Update resolved → 读回生效", () => {
      dbCreate(testDb.db, "defects", "def-1", SAMPLE_DEFECT);
      dbUpdate(testDb.db, "defects", "def-1", { ...SAMPLE_DEFECT, resolved: true });
      const r = dbGetById(testDb.db, "defects", "def-1");
      expect(r!.resolved).toBe(true);
    });
  });

  describe("chatSessions", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "chatSessions", "session-1", SAMPLE_CHAT_SESSION);
      const r = dbGetById(testDb.db, "chatSessions", "session-1");
      expect(r!.title).toBe("文档解读对话");
    });
  });

  describe("chatMessages", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "chatMessages", "msg-1", SAMPLE_CHAT_MESSAGE);
      const r = dbGetById(testDb.db, "chatMessages", "msg-1");
      expect(r!.role).toBe("user");
      expect(r!.moduleScope).toBe("case");
      expect(r!.content).toBe("这个技术方案的核心创新在哪？");
    });
    it("Query by moduleScope → 隔离正确", () => {
      dbCreate(testDb.db, "chatMessages", "msg-1", SAMPLE_CHAT_MESSAGE);
      dbCreate(testDb.db, "chatMessages", "msg-2", { ...SAMPLE_CHAT_MESSAGE, moduleScope: "claim-chart", content: "另一条消息" });
      const caseMessages = dbQuery(testDb.db, "chatMessages", "moduleScope", "case");
      expect(caseMessages.length).toBe(1);
    });
  });

  describe("opinionAnalyses", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "opinionAnalyses", "oa-1", SAMPLE_OPINION_ANALYSIS);
      const r = dbGetById(testDb.db, "opinionAnalyses", "oa-1");
      expect(r!.caseId).toBe("case-1");
      expect((r!.analysisData as Record<string, unknown>).rejectionGrounds).toBeDefined();
    });
  });

  describe("argumentMappings", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "argumentMappings", "am-1", SAMPLE_ARGUMENT_MAPPING);
      const r = dbGetById(testDb.db, "argumentMappings", "am-1");
      expect(r!.claimFeature).toBe("A");
      expect(r!.argument).toBe("申请人认为D1未公开特征A");
    });
  });

  describe("interpretSummaries", () => {
    it("Create → GetById → 嵌套 summaries 映射完整", () => {
      dbCreate(testDb.db, "interpretSummaries", "case-1", SAMPLE_INTERPRET_SUMMARIES);
      const r = dbGetById(testDb.db, "interpretSummaries", "case-1");
      expect(r!.caseId).toBe("case-1");
      const summaries = r!.summaries as Record<string, string>;
      expect(summaries["doc-app-1"]).toContain("LED灯具");
      expect(summaries["doc-ref-d1"]).toContain("D1");
    });
  });

  describe("reexamDrafts", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "reexamDrafts", "case-1", SAMPLE_REEXAM_DRAFT);
      const r = dbGetById(testDb.db, "reexamDrafts", "case-1");
      expect(r!.caseId).toBe("case-1");
      expect((r!.responseItems as unknown[]).length).toBe(1);
    });
  });

  describe("summaries", () => {
    it("Create → GetById → 字段一致", () => {
      dbCreate(testDb.db, "summaries", "case-1", SAMPLE_SUMMARY);
      const r = dbGetById(testDb.db, "summaries", "case-1");
      expect(r!.body).toContain("LED灯具");
    });
  });

  describe("runMarkers", () => {
    it("Create → GetById → 复合 ID 正确", () => {
      const id = `${SAMPLE_RUN_MARKER.caseId}::${SAMPLE_RUN_MARKER.module}`;
      dbCreate(testDb.db, "runMarkers", id, SAMPLE_RUN_MARKER);
      const r = dbGetById(testDb.db, "runMarkers", id);
      expect(r).not.toBeNull();
      expect(r!.caseId).toBe("case-1");
      expect(r!.module).toBe("claimChart");
    });
  });

  describe("searchSessions", () => {
    it("Create → GetById → 嵌套数组完整", () => {
      dbCreate(testDb.db, "searchSessions", "ss-1", SAMPLE_SEARCH_SESSION);
      const r = dbGetById(testDb.db, "searchSessions", "ss-1");
      expect((r!.queries as unknown[]).length).toBe(1);
      expect((r!.results as unknown[]).length).toBe(1);
    });
  });

  describe("textIndex", () => {
    it("Create → GetById → 大对象完整", () => {
      dbCreate(testDb.db, "textIndex", "doc-1", SAMPLE_TEXT_INDEX);
      const r = dbGetById(testDb.db, "textIndex", "doc-1");
      expect(r).not.toBeNull();
      expect((r!.pages as unknown[]).length).toBe(2);
      expect((r!.paragraphs as unknown[]).length).toBe(2);
      expect(r!.lineMap).toBeDefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// §三 复杂嵌套对象一致性
// ══════════════════════════════════════════════════════════════════════

describe("§三 复杂嵌套对象一致性", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMemoryDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("claimCharts.specificationCitations[] 含 10 条 citation → 完整保留", () => {
    const citations = Array.from({ length: 10 }, (_, i) => ({
      label: `说明书第${String(i + 1).padStart(3, "0")}段`,
      paragraph: String(i + 1),
      quote: `引文片段${i + 1}，包含中文和English混合`,
      confidence: (["high", "medium", "low"] as const)[i % 3],
    }));
    const chart = { ...SAMPLE_CLAIM_CHART, specificationCitations: citations };
    dbCreate(testDb.db, "claimCharts", "cc-10c", chart);
    const r = dbGetById(testDb.db, "claimCharts", "cc-10c");
    const readCitations = r!.specificationCitations as Array<Record<string, unknown>>;
    expect(readCitations.length).toBe(10);
    expect(readCitations[0]!.confidence).toBe("high");
    expect(readCitations[1]!.confidence).toBe("medium");
    expect(readCitations[2]!.confidence).toBe("low");
  });

  it("novelty.rows[0].citations[0].quote 含中文 + 特殊字符 → 字符串完全匹配", () => {
    const specialQuote = '散热基板（A），由"铝合金"材料制成，表面设有均匀分布的散热翅片；导热界面层（B）';
    const novelty = {
      ...SAMPLE_NOVELTY,
      rows: [
        {
          featureCode: "A",
          disclosureStatus: "clearly-disclosed",
          citations: [{ documentId: "ref-d1", label: "D1 §0023", quote: specialQuote, confidence: "high" }],
          reviewerNotes: "",
        },
      ],
    };
    dbCreate(testDb.db, "novelty", "nov-special", novelty);
    const r = dbGetById(testDb.db, "novelty", "nov-special");
    const row0 = (r!.rows as Array<Record<string, unknown>>)[0]!;
    const cit0 = (row0.citations as Array<Record<string, unknown>>)[0]!;
    expect(cit0.quote).toBe(specialQuote);
  });

  it("inventive.features[] 含多个 feature 分析 → 嵌套结构完整", () => {
    const inv = {
      ...SAMPLE_INVENTIVE,
      features: [
        { featureCode: "B", analysis: "石墨烯导热膜未在D1中公开", conclusion: "possibly-inventive" },
        { featureCode: "C", analysis: "风冷模块未在D1中公开", conclusion: "possibly-inventive" },
        { featureCode: "D", analysis: "温度传感器在D1中有部分公开", conclusion: "not-analyzed" },
      ],
    };
    dbCreate(testDb.db, "inventive", "inv-multi", inv);
    const r = dbGetById(testDb.db, "inventive", "inv-multi");
    expect((r!.features as unknown[]).length).toBe(3);
  });

  it("providerErrorMessages[] 含 50 条 → 数组长度 = 50，每条 id 唯一", () => {
    const errors = Array.from({ length: 50 }, (_, i) => ({
      id: `err-${String(i).padStart(3, "0")}`,
      providerId: "mimo",
      errorCode: "quota-exceeded",
      message: `Error ${i}`,
      timestamp: new Date(2026, 5, 4, 10, i).toISOString(),
      read: false,
      agent: "novelty",
      caseId: `case-${i}`,
    }));
    const settings = { ...FULL_SETTINGS, providerErrorMessages: errors };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    const msgs = r!.providerErrorMessages as Array<Record<string, unknown>>;
    expect(msgs.length).toBe(50);
    const ids = new Set(msgs.map((m) => m.id));
    expect(ids.size).toBe(50);
  });

  it("chatMessages content 含 markdown + 代码块 → 内容不被转义破坏", () => {
    const mdContent = `## 分析结果

\`\`\`json
{
  "featureCode": "A",
  "status": "公开"
}
\`\`\`

> 引用文本 & 特殊字符 <tag> "quotes" 'single'`;
    dbCreate(testDb.db, "chatMessages", "msg-md", { ...SAMPLE_CHAT_MESSAGE, content: mdContent });
    const r = dbGetById(testDb.db, "chatMessages", "msg-md");
    expect(r!.content).toBe(mdContent);
  });
});

// ══════════════════════════════════════════════════════════════════════
// §四 边界场景
// ══════════════════════════════════════════════════════════════════════

describe("§四 边界场景", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMemoryDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("apiKeyRef: ''（空字符串）→ 持久化后读回为空字符串", () => {
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, apiKeyRef: "" }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.apiKeyRef).toBe("");
  });

  it("apiKeyRef 超长 key（2000 字符）→ 完整保留", () => {
    const longKey = "sk-" + "x".repeat(2000);
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, apiKeyRef: longKey }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.apiKeyRef).toBe(longKey);
  });

  it("apiKeyRef 含中文 '测试密钥' → 完整保留", () => {
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, apiKeyRef: "测试密钥" }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.apiKeyRef).toBe("测试密钥");
  });

  it("apiKeyRef 含 JSON 特殊字符 → 不被 JSON.parse 破坏", () => {
    const specialKey = 'key\\"with\\"quotes';
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, apiKeyRef: specialKey }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.apiKeyRef).toBe(specialKey);
  });

  it("modelIds: []（空数组）→ 读回为空数组", () => {
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, modelIds: [] }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.modelIds).toEqual([]);
    expect(Array.isArray((r!.providers as Array<Record<string, unknown>>)[0]!.modelIds)).toBe(true);
  });

  it("modelIds 含 50 个模型 → 全部保留", () => {
    const models = Array.from({ length: 50 }, (_, i) => `model-${i}`);
    const settings = {
      ...FULL_SETTINGS,
      providers: [{ ...FULL_SETTINGS.providers[0]!, modelIds: models }],
    };
    dbCreate(testDb.db, "settings", "app", settings);
    const r = dbGetById(testDb.db, "settings", "app");
    expect((r!.providers as Array<Record<string, unknown>>)[0]!.modelIds).toEqual(models);
  });

  it("DELETE + INSERT 同 ID → 不冲突", () => {
    dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
    dbDelete(testDb.db, "cases", "case-1");
    dbCreate(testDb.db, "cases", "case-1", { ...SAMPLE_CASE, title: "新案件" });
    const r = dbGetById(testDb.db, "cases", "case-1");
    expect(r!.title).toBe("新案件");
  });

  it("连续 10 次 INSERT OR REPLACE 同 ID → 最终值为最后一次写入", () => {
    for (let i = 0; i < 10; i++) {
      dbCreate(testDb.db, "cases", "case-1", { ...SAMPLE_CASE, title: `版本${i}` });
    }
    const r = dbGetById(testDb.db, "cases", "case-1");
    expect(r!.title).toBe("版本9");
  });

  it("clearAllLocalData 后查询所有 store → 全部返回空", () => {
    // 写入所有 store 的数据
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);
    dbCreate(testDb.db, "cases", "case-1", SAMPLE_CASE);
    dbCreate(testDb.db, "documents", "doc-1", SAMPLE_DOCUMENT);
    dbCreate(testDb.db, "claimCharts", "cc-1", SAMPLE_CLAIM_CHART);
    dbCreate(testDb.db, "novelty", "nov-1", SAMPLE_NOVELTY);
    dbCreate(testDb.db, "inventive", "inv-1", SAMPLE_INVENTIVE);
    dbCreate(testDb.db, "chatMessages", "msg-1", SAMPLE_CHAT_MESSAGE);
    dbCreate(testDb.db, "textIndex", "doc-1", SAMPLE_TEXT_INDEX);
    dbCreate(testDb.db, "interpretSummaries", "case-1", SAMPLE_INTERPRET_SUMMARIES);
    dbCreate(testDb.db, "defects", "def-1", SAMPLE_DEFECT);
    dbCreate(testDb.db, "chatSessions", "session-1", SAMPLE_CHAT_SESSION);
    dbCreate(testDb.db, "opinionAnalyses", "oa-1", SAMPLE_OPINION_ANALYSIS);
    dbCreate(testDb.db, "argumentMappings", "am-1", SAMPLE_ARGUMENT_MAPPING);
    dbCreate(testDb.db, "reexamDrafts", "case-1", SAMPLE_REEXAM_DRAFT);
    dbCreate(testDb.db, "summaries", "case-1", SAMPLE_SUMMARY);
    dbCreate(testDb.db, "runMarkers", "case-1::claimChart", SAMPLE_RUN_MARKER);
    dbCreate(testDb.db, "searchSessions", "ss-1", SAMPLE_SEARCH_SESSION);

    // clearAll
    dbClearAll(testDb.db);

    // 验证所有 store 为空
    for (const store of ALL_STORES) {
      const records = dbGetAll(testDb.db, store);
      expect(records.length).toBe(0);
    }
  });

  it("clearAllLocalData 后重新写入 settings → 正常工作，无脏数据残留", () => {
    dbCreate(testDb.db, "settings", "app", FULL_SETTINGS);
    dbClearAll(testDb.db);
    dbCreate(testDb.db, "settings", "app", { ...FULL_SETTINGS, mode: "mock" });
    const r = dbGetById(testDb.db, "settings", "app");
    expect(r!.mode).toBe("mock");
    expect(r!.providers).toEqual(FULL_SETTINGS.providers);
  });
});

// ══════════════════════════════════════════════════════════════════════
// §六.1 HTTP 全链路 Round-Trip 测试
// ══════════════════════════════════════════════════════════════════════

describe("§六.1 HTTP 全链路 Round-Trip", () => {
  // 动态导入以确保 resetSyncDbForTesting 在 import routes 之前调用
  let app: import("express-serve-static-core").Express;
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = createMemoryDb();
    resetSyncDbForTesting(testDb.path === ":memory:" ? ":memory:" : testDb.path);

    const express = await import("express");
    const { dataRouter } = await import("@server/routes/data.js");

    app = express.default();
    app.use(express.default.json({ limit: "1mb" }));
    app.use("/api", dataRouter);
  });

  afterAll(() => {
    testDb.cleanup();
  });

  beforeEach(() => {
    // 清空所有数据
    testDb.db.exec("DELETE FROM sync_data");
  });

  it("TC-6.1.1: POST settings → GET settings/app → deepEqual", async () => {
    const { default: request } = await import("supertest");

    // POST 写入
    const postRes = await request(app)
      .post("/api/data/settings")
      .send(FULL_SETTINGS)
      .expect(200);

    expect(postRes.body.ok).toBe(true);

    // GET 读回
    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(getRes.body.ok).toBe(true);
    const record = getRes.body.record;
    expect(record.mode).toBe("real");
    expect(record.providers).toEqual(FULL_SETTINGS.providers);
    expect(record.agents).toEqual(FULL_SETTINGS.agents);
    expect(record.searchProviders).toEqual(FULL_SETTINGS.searchProviders);
    expect(record.knowledge).toEqual(FULL_SETTINGS.knowledge);
    expect(record.knowledgeProviders).toEqual(FULL_SETTINGS.knowledgeProviders);
  });

  it("TC-6.1.2: POST 写入 → PUT 更新单个字段 → GET → 其余字段不变", async () => {
    const { default: request } = await import("supertest");

    await request(app)
      .post("/api/data/settings")
      .send(FULL_SETTINGS)
      .expect(200);

    // PUT 更新 mode
    await request(app)
      .put("/api/data/settings/app")
      .send({ ...FULL_SETTINGS, mode: "mock" })
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(getRes.body.record.mode).toBe("mock");
    expect(getRes.body.record.providers).toEqual(FULL_SETTINGS.providers);
  });

  it("TC-6.1.3: EPO key 含冒号 → HTTP 传输不被截断", async () => {
    const { default: request } = await import("supertest");

    await request(app)
      .post("/api/data/settings")
      .send(FULL_SETTINGS)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    const epo = getRes.body.record.searchProviders.find((p: Record<string, string>) => p.providerId === "epo");
    expect(epo.apiKeyRef).toBe("epo-consumer:epo-secret");
  });

  it("TC-6.1.4: knowledgeProviders 同 providerId 不同 providerType → HTTP 层独立", async () => {
    const { default: request } = await import("supertest");

    await request(app)
      .post("/api/data/settings")
      .send(FULL_SETTINGS)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    const kps = getRes.body.record.knowledgeProviders;
    expect(kps.length).toBe(2);
    expect(kps[0].providerType).toBe("embedding");
    expect(kps[1].providerType).toBe("reranker");
  });

  it("TC-6.1.5: 空 providers: [] → GET → 空数组非 undefined", async () => {
    const { default: request } = await import("supertest");

    const settings = { ...FULL_SETTINGS, providers: [] };
    await request(app)
      .post("/api/data/settings")
      .send(settings)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(Array.isArray(getRes.body.record.providers)).toBe(true);
    expect(getRes.body.record.providers.length).toBe(0);
  });

  it("TC-6.1.6: enableProviderFallback: false → GET → 确认为 false", async () => {
    const { default: request } = await import("supertest");

    const settings = { ...FULL_SETTINGS, enableProviderFallback: false };
    await request(app)
      .post("/api/data/settings")
      .send(settings)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(getRes.body.record.enableProviderFallback).toBe(false);
  });

  it("TC-6.1.7: 不含 knowledge 字段 → GET → 确认为 undefined", async () => {
    const { default: request } = await import("supertest");

    const { knowledge: _k, ...settings } = FULL_SETTINGS;
    await request(app)
      .post("/api/data/settings")
      .send(settings)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(getRes.body.record.knowledge).toBeUndefined();
  });

  it("TC-6.1.8: 50 条 providerErrorMessages → GET → 数量和内容一致", async () => {
    const { default: request } = await import("supertest");

    const errors = Array.from({ length: 50 }, (_, i) => ({
      id: `err-${String(i).padStart(3, "0")}`,
      providerId: "mimo",
      errorCode: "quota-exceeded",
      message: `Error ${i}`,
      timestamp: new Date(2026, 5, 4, 10, i).toISOString(),
      read: false,
      agent: "novelty",
      caseId: `case-${i}`,
    }));
    const settings = { ...FULL_SETTINGS, providerErrorMessages: errors };
    await request(app)
      .post("/api/data/settings")
      .send(settings)
      .expect(200);

    const getRes = await request(app)
      .get("/api/data/settings/app")
      .expect(200);

    expect(getRes.body.record.providerErrorMessages.length).toBe(50);
    expect(getRes.body.record.providerErrorMessages[0].id).toBe("err-000");
  });
});
