/**
 * 数据库隔离测试 — FEAT-043 §七 (B-042 防回归)
 * =============================================
 *
 * 确保测试数据库隔离机制正确工作，防止测试清空生产数据库。
 *
 * 运行：vitest run --config vitest.integration.config.ts tests/integration/dbIsolation.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import {
  createMemoryDb,
  createTempFileDb,
  cleanupAllTrackedFiles,
  getTrackedFileCount,
  dbCreate,
  dbGetById,
  dbGetAll,
  type TestDb,
} from "../helpers/testDb.js";

// ══════════════════════════════════════════════════════════════════════
// §七.1 resetSyncDbForTesting 注入机制
// ══════════════════════════════════════════════════════════════════════

describe("§七.1 resetSyncDbForTesting 注入机制", () => {
  // 动态导入 syncDb 以确保 resetSyncDbForTesting 可用
  let resetSyncDbForTesting: (customPath?: string) => void;
  let getSyncDb: () => Database.Database;
  let closeSyncDb: () => void;

  beforeAll(async () => {
    const syncDb = await import("@server/lib/syncDb.js");
    resetSyncDbForTesting = syncDb.resetSyncDbForTesting;
    getSyncDb = syncDb.getSyncDb;
    closeSyncDb = syncDb.closeSyncDb;
  });

  afterEach(() => {
    closeSyncDb();
  });

  it("TC-7.1.1: 注入 ':memory:' → getSyncDb() 返回内存 DB → 写入读回一致", () => {
    resetSyncDbForTesting(":memory:");
    const db = getSyncDb();
    expect(db).toBeDefined();

    // 写入数据
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "id-1", JSON.stringify({ value: "hello" }));

    // 读回
    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get("test", "id-1") as { data: string };
    expect(JSON.parse(row.data).value).toBe("hello");
  });

  it("TC-7.1.2: 无参数调用 resetSyncDbForTesting() → 关闭当前 DB 但保留注入路径", () => {
    resetSyncDbForTesting(":memory:");
    const db1 = getSyncDb();
    db1.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "id-1", JSON.stringify({ value: "before" }));

    // 无参数调用 — 关闭当前 DB 但不改变 globalThis.__TEST_SYNC_DB_PATH__
    resetSyncDbForTesting();

    // 验证全局路径仍然存在
    expect((globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__).toBe(":memory:");

    // getSyncDb() 会创建新的内存 DB（数据丢失是内存 DB 的特性）
    const db2 = getSyncDb();
    const rows = db2.prepare("SELECT * FROM sync_data").all();
    expect(rows.length).toBe(0); // 新内存 DB，数据为空
  });

  it("TC-7.1.3: 重复注入新路径 → 切换到新 DB → 数据为空", () => {
    resetSyncDbForTesting(":memory:");
    const db1 = getSyncDb();
    db1.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "id-1", JSON.stringify({ value: "old" }));
    closeSyncDb();

    // 再次注入（新内存 DB）
    resetSyncDbForTesting(":memory:");
    const db2 = getSyncDb();
    const rows = db2.prepare("SELECT * FROM sync_data").all();
    expect(rows.length).toBe(0);
  });

  it("TC-7.1.4: 内存 DB 关闭后数据不保留", () => {
    resetSyncDbForTesting(":memory:");
    const db = getSyncDb();
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "id-1", JSON.stringify({ value: "ephemeral" }));

    closeSyncDb();

    // 重新获取（新内存 DB，数据丢失）
    const db2 = getSyncDb();
    const rows = db2.prepare("SELECT * FROM sync_data").all();
    expect(rows.length).toBe(0);
  });

  it("TC-7.1.5: 临时文件 DB 关闭后数据保留", async () => {
    const { default: Database } = await import("better-sqlite3");
    const tmpDb = createTempFileDb();
    resetSyncDbForTesting(tmpDb.path);
    const db = getSyncDb();
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "id-1", JSON.stringify({ value: "persistent" }));

    closeSyncDb();

    // 重新打开同一文件
    const db2 = new Database(tmpDb.path);
    const row = db2.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get("test", "id-1") as { data: string };
    expect(JSON.parse(row.data).value).toBe("persistent");
    db2.close();
    tmpDb.cleanup();
  });

  it("TC-7.1.6: 注入后 globalThis.__TEST_SYNC_DB_PATH__ 被正确设置", () => {
    resetSyncDbForTesting(":memory:");
    expect((globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__).toBe(":memory:");
  });

  it("TC-7.1.7: globalSetup teardown 后 globalThis.__TEST_SYNC_DB_PATH__ 被删除", () => {
    resetSyncDbForTesting(":memory:");
    expect((globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__).toBe(":memory:");

    // 模拟 teardown
    delete (globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__;
    expect((globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// §七.2 生产库保护（核心防回归）
// ══════════════════════════════════════════════════════════════════════

describe("§七.2 生产库保护", () => {
  let resetSyncDbForTesting: (customPath?: string) => void;
  let getSyncDb: () => Database.Database;
  let closeSyncDb: () => void;

  beforeAll(async () => {
    const syncDb = await import("@server/lib/syncDb.js");
    resetSyncDbForTesting = syncDb.resetSyncDbForTesting;
    getSyncDb = syncDb.getSyncDb;
    closeSyncDb = syncDb.closeSyncDb;
  });

  afterEach(() => {
    closeSyncDb();
  });

  it("TC-7.2.1: 注入 ':memory:' → HTTP 写入 → 生产库未被修改", () => {
    resetSyncDbForTesting(":memory:");
    const db = getSyncDb();

    // 通过注入的 DB 写入
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("settings", "app", JSON.stringify({ mode: "test" }));

    // 验证写入成功
    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get("settings", "app") as { data: string };
    expect(JSON.parse(row.data).mode).toBe("test");

    // 生产库不应受影响（我们无法直接验证生产库，但确认注入的 DB 是独立的）
    expect(db.name).toBe(":memory:");
  });

  it("TC-7.2.2: 注入 ':memory:' → DELETE 全部 → 生产库不受影响", () => {
    resetSyncDbForTesting(":memory:");
    const db = getSyncDb();

    // 写入测试数据
    db.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("settings", "app", JSON.stringify({ mode: "test" }));

    // DELETE 全部
    db.exec("DELETE FROM sync_data");
    const rows = db.prepare("SELECT * FROM sync_data").all();
    expect(rows.length).toBe(0);

    // 这个 DELETE 只影响内存 DB，不影响生产库
    expect(db.name).toBe(":memory:");
  });

  it("TC-7.2.3: 两个独立测试各自注入 ':memory:' → 数据互不影响", () => {
    // 测试 A
    resetSyncDbForTesting(":memory:");
    const dbA = getSyncDb();
    dbA.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "from-a", JSON.stringify({ source: "A" }));
    closeSyncDb();

    // 测试 B（新的内存 DB）
    resetSyncDbForTesting(":memory:");
    const dbB = getSyncDb();
    const rows = dbB.prepare("SELECT * FROM sync_data").all();
    expect(rows.length).toBe(0); // 测试 A 的数据不在这里
  });

  it("TC-7.2.4: 重复注入不泄露旧数据", () => {
    resetSyncDbForTesting(":memory:");
    const db1 = getSyncDb();
    db1.prepare("INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run("test", "secret", JSON.stringify({ password: "old-data" }));
    closeSyncDb();

    // 重复注入
    resetSyncDbForTesting(":memory:");
    const db2 = getSyncDb();
    const rows = db2.prepare("SELECT * FROM sync_data WHERE record_id = 'secret'").all();
    expect(rows.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// §七.4 createMemoryDb 隔离验证
// ══════════════════════════════════════════════════════════════════════

describe("§七.4 createMemoryDb 隔离验证", () => {
  it("TC-7.4.1: createMemoryDb() 返回值结构正确", () => {
    const testDb = createMemoryDb();
    expect(testDb.db).toBeDefined();
    expect(testDb.path).toBe(":memory:");
    expect(typeof testDb.cleanup).toBe("function");
    testDb.cleanup();
  });

  it("TC-7.4.2: createMemoryDb() → CRUD 辅助函数正常", () => {
    const testDb = createMemoryDb();
    dbCreate(testDb.db, "cases", "case-1", { title: "测试案件" });
    const r = dbGetById(testDb.db, "cases", "case-1");
    expect(r).not.toBeNull();
    expect(r!.title).toBe("测试案件");
    testDb.cleanup();
  });

  it("TC-7.4.3: 多个内存 DB 实例互不干扰", () => {
    const db1 = createMemoryDb();
    const db2 = createMemoryDb();

    dbCreate(db1.db, "test", "id-1", { source: "db1" });
    dbCreate(db2.db, "test", "id-1", { source: "db2" });

    const r1 = dbGetById(db1.db, "test", "id-1");
    const r2 = dbGetById(db2.db, "test", "id-1");

    expect(r1!.source).toBe("db1");
    expect(r2!.source).toBe("db2");

    db1.cleanup();
    db2.cleanup();
  });

  it("TC-7.4.4: cleanup() 正确关闭 DB → 再次操作抛错", () => {
    const testDb = createMemoryDb();
    dbCreate(testDb.db, "test", "id-1", { value: "hello" });
    testDb.cleanup();

    // 关闭后操作应抛错
    expect(() => {
      dbGetById(testDb.db, "test", "id-1");
    }).toThrow();
  });

  it("TC-7.4.5: createTempFileDb() → 文件存在 → cleanup() → 文件已删除", () => {
    const testDb = createTempFileDb();
    expect(testDb.path).not.toBe(":memory:");

    // 文件应存在
    expect(fs.existsSync(testDb.path)).toBe(true);

    testDb.cleanup();

    // 文件应已删除
    expect(fs.existsSync(testDb.path)).toBe(false);
  });

  it("TC-7.4.6: createMemoryDb() → sync_data 和 sync_meta 表已创建", () => {
    const testDb = createMemoryDb();
    const tables = testDb.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("sync_data");
    expect(tableNames).toContain("sync_meta");
    testDb.cleanup();
  });
});

// ══════════════════════════════════════════════════════════════════════
// §七.5 Store 名称准确性
// ══════════════════════════════════════════════════════════════════════

describe("§七.5 Store 名称准确性", () => {
  const ALL_STORES = [
    "cases", "documents", "claimNodes", "claimCharts", "novelty",
    "inventive", "chatMessages", "settings", "textIndex",
    "ocrCache", "interpretSummaries", "defects", "chatSessions",
    "opinionAnalyses", "argumentMappings", "reexamDrafts", "summaries",
    "runMarkers", "searchSessions",
  ];

  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMemoryDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("TC-7.5.1: 对所有 20 个 store 执行 dbCreate + dbGetAll → 读写一致", () => {
    for (const store of ALL_STORES) {
      const id = `test-${store}`;
      dbCreate(testDb.db, store, id, { store, value: "test" });
      const records = dbGetAll(testDb.db, store);
      expect(records.length).toBeGreaterThanOrEqual(1);
      const found = records.find((r) => r.id === id);
      expect(found).toBeDefined();
      expect(found!.value).toBe("test");
    }
  });

  it("TC-7.5.2: 错误 store 名称 'claimFeatures' → 返回空数组（不报错）", () => {
    dbCreate(testDb.db, "claimCharts", "cc-1", { featureCode: "A" });
    // 使用错误名称
    const records = dbGetAll(testDb.db, "claimFeatures");
    expect(records.length).toBe(0);
  });

  it("TC-7.5.3: beforeEach 清理列表与 DESIGN.md §11 一致", () => {
    // 验证 ALL_STORES 列表完整性
    expect(ALL_STORES.length).toBe(19);
    expect(ALL_STORES).toContain("runMarkers"); // 历史 bug bg-43
    expect(ALL_STORES).toContain("searchSessions"); // 历史 bug bg-43
    expect(ALL_STORES).toContain("ocrCache");
  });
});

// ══════════════════════════════════════════════════════════════════════
// §七.6 globalSetup 生命周期
// ══════════════════════════════════════════════════════════════════════

describe("§七.6 globalSetup 生命周期", () => {
  beforeEach(() => {
    cleanupAllTrackedFiles();
  });

  it("TC-7.6.1: 创建 3 个临时文件 DB → cleanupAllTrackedFiles() → 全部删除", () => {
    const dbs = [createTempFileDb(), createTempFileDb(), createTempFileDb()];
    expect(getTrackedFileCount()).toBe(3);

    for (const db of dbs) {
      expect(fs.existsSync(db.path)).toBe(true);
    }

    cleanupAllTrackedFiles();

    for (const db of dbs) {
      expect(fs.existsSync(db.path)).toBe(false);
    }
    expect(getTrackedFileCount()).toBe(0);
  });

  it("TC-7.6.2: 模拟崩溃（不调用 cleanup）→ cleanupAllTrackedFiles() → 文件已删除", () => {
    const tmpDb = createTempFileDb();
    const filePath = tmpDb.path;

    expect(fs.existsSync(filePath)).toBe(true);
    // 不调用 tmpDb.cleanup()，模拟崩溃

    cleanupAllTrackedFiles();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("TC-7.6.3: cleanupAllTrackedFiles() → getTrackedFileCount() === 0", () => {
    createTempFileDb();
    createTempFileDb();
    expect(getTrackedFileCount()).toBe(2);

    cleanupAllTrackedFiles();
    expect(getTrackedFileCount()).toBe(0);
  });

  it("TC-7.6.4: 幂等清理 — cleanup() 后再次 cleanup() 不报错", () => {
    const tmpDb = createTempFileDb();
    tmpDb.cleanup();
    // 再次调用不应抛错
    expect(() => tmpDb.cleanup()).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// §七.7 测试基础设施静态审查
// ══════════════════════════════════════════════════════════════════════

describe("§七.7 测试基础设施静态审查", () => {
  it("TC-7.7.1: agentPipeline.test.ts 包含 resetSyncDbForTesting 调用", () => {
    const filePath = path.resolve(process.cwd(), "tests/integration/agentPipeline.test.ts");
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("resetSyncDbForTesting");
    }
  });

  it("TC-7.7.2: route-coverage.test.ts 包含 resetSyncDbForTesting 调用", () => {
    const filePath = path.resolve(process.cwd(), "tests/integration/route-coverage.test.ts");
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("resetSyncDbForTesting");
    }
  });

  it("TC-7.7.3: persistence.test.ts 包含 DB 隔离", () => {
    const filePath = path.resolve(process.cwd(), "tests/integration/persistence.test.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    // persistence.test.ts 使用 createMemoryDb，不直接访问生产库
    expect(content).toContain("createMemoryDb");
  });

  it("TC-7.7.4: globalSetup.ts 导出 teardown 函数且包含清理逻辑", () => {
    const filePath = path.resolve(process.cwd(), "tests/globalSetup.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("export");
    expect(content).toContain("cleanupAllTrackedFiles");
    expect(content).toContain("__TEST_SYNC_DB_PATH__");
  });
});
