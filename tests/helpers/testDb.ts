/**
 * 测试数据库辅助模块 — B-042: 测试数据库隔离机制
 *
 * 提供三种模式的数据库创建和清理：
 *   1. 内存数据库 (`:memory:`) — 最快，适合单元测试和快速集成测试
 *   2. 临时文件数据库 — 适合文件系统相关测试
 *   3. 生产数据快照副本 — 适合数据迁移/备份恢复测试
 *
 * 利用 syncDb.ts 的 resetSyncDbForTesting() 实现测试隔离。
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

/** 测试数据库实例 */
export interface TestDb {
  /** better-sqlite3 数据库实例 */
  db: Database.Database;
  /** 数据库文件路径（内存数据库为 `:memory:`） */
  path: string;
  /** 清理函数：关闭数据库并删除临时文件 */
  cleanup: () => void;
}

/** 全局追踪所有临时文件，确保崩溃时也能清理 */
const trackedTempFiles = new Set<string>();

/**
 * 创建内存数据库（最快）
 * 适合：单元测试、快速集成测试、业务逻辑测试
 */
export function createMemoryDb(): TestDb {
  const db = new Database(":memory:");
  initSchema(db);
  return {
    db,
    path: ":memory:",
    cleanup: () => {
      db.close();
    },
  };
}

/**
 * 创建临时文件数据库
 * 适合：文件系统相关测试（路径解析、权限、并发、损坏恢复）
 * 测试结束后自动删除临时文件
 */
export function createTempFileDb(): TestDb {
  const tmpDir = path.join(os.tmpdir(), "patent-examiner-test");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const fileName = `test-${crypto.randomUUID()}.db`;
  const filePath = path.join(tmpDir, fileName);

  trackedTempFiles.add(filePath);

  const db = new Database(filePath);
  initSchema(db);
  return {
    db,
    path: filePath,
    cleanup: () => {
      db.close();
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        // 清理 WAL 和 SHM 文件
        for (const suffix of ["-wal", "-shm"]) {
          const sideFile = filePath + suffix;
          if (fs.existsSync(sideFile)) {
            fs.unlinkSync(sideFile);
          }
        }
      } catch {
        // 忽略清理错误（文件可能已被锁定）
      }
      trackedTempFiles.delete(filePath);
    },
  };
}

/**
 * 创建生产数据库快照副本
 * 适合：迁移测试、备份恢复测试、数据完整性测试
 * 从生产数据库复制一份到临时位置，测试结束后删除
 */
export function createSnapshotDb(sourceDbPath?: string): TestDb {
  const source = sourceDbPath ?? path.resolve(process.cwd(), "data", "patent-examiner.db");

  if (!fs.existsSync(source)) {
    // 生产数据库不存在时，回退到临时文件数据库
    return createTempFileDb();
  }

  const tmpDir = path.join(os.tmpdir(), "patent-examiner-test");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const fileName = `snapshot-${crypto.randomUUID()}.db`;
  const filePath = path.join(tmpDir, fileName);

  trackedTempFiles.add(filePath);

  // 复制数据库文件
  fs.copyFileSync(source, filePath);

  const db = new Database(filePath);
  return {
    db,
    path: filePath,
    cleanup: () => {
      db.close();
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        for (const suffix of ["-wal", "-shm"]) {
          const sideFile = filePath + suffix;
          if (fs.existsSync(sideFile)) {
            fs.unlinkSync(sideFile);
          }
        }
      } catch {
        // 忽略清理错误
      }
      trackedTempFiles.delete(filePath);
    },
  };
}

/**
 * 初始化 sync_data 表结构（与 syncDb.ts 一致）
 */
function initSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_data (
      store_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (store_name, record_id)
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * 清理所有追踪的临时文件（全局 teardown 用）
 * 即使测试崩溃也会被 globalTeardown 调用
 */
export function cleanupAllTrackedFiles(): void {
  for (const filePath of trackedTempFiles) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      for (const suffix of ["-wal", "-shm"]) {
        const sideFile = filePath + suffix;
        if (fs.existsSync(sideFile)) {
          fs.unlinkSync(sideFile);
        }
      }
    } catch {
      // 忽略
    }
  }
  trackedTempFiles.clear();

  // 清理临时目录（如果为空）
  const tmpDir = path.join(os.tmpdir(), "patent-examiner-test");
  try {
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      if (files.length === 0) {
        fs.rmdirSync(tmpDir);
      }
    }
  } catch {
    // 忽略
  }
}

/**
 * 获取当前追踪的临时文件数量（调试用）
 */
export function getTrackedFileCount(): number {
  return trackedTempFiles.size;
}

// ── CRUD 辅助函数（与 server/src/routes/data.ts 使用的 SQL 模式一致）──

/** 向 sync_data 表写入一条记录 */
export function dbCreate(db: Database.Database, store: string, id: string, data: Record<string, unknown>): void {
  db.prepare(
    "INSERT OR REPLACE INTO sync_data (store_name, record_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
  ).run(store, id, JSON.stringify(data));
}

/** 读取指定 store 的所有记录 */
export function dbGetAll<T extends Record<string, unknown>>(db: Database.Database, store: string): Array<T & { id: string }> {
  const rows = db.prepare("SELECT record_id, data FROM sync_data WHERE store_name = ?").all(store) as Array<{
    record_id: string;
    data: string;
  }>;
  return rows.map((row) => ({ id: row.record_id, ...JSON.parse(row.data) }));
}

/** 按 ID 读取单条记录 */
export function dbGetById<T extends Record<string, unknown>>(db: Database.Database, store: string, id: string): (T & { id: string }) | null {
  const row = db.prepare("SELECT data FROM sync_data WHERE store_name = ? AND record_id = ?").get(store, id) as {
    data: string;
  } | undefined;
  if (!row) return null;
  return { id, ...JSON.parse(row.data) };
}

/** 按字段值过滤记录（内存过滤，与 data.ts query 一致）*/
export function dbQuery<T extends Record<string, unknown>>(
  db: Database.Database, store: string, field: string, value: unknown
): Array<T & { id: string }> {
  return dbGetAll<T>(db, store).filter((r) => (r as Record<string, unknown>)[field] === value);
}

/** 更新记录 */
export function dbUpdate(db: Database.Database, store: string, id: string, data: Record<string, unknown>): boolean {
  const result = db.prepare(
    "UPDATE sync_data SET data = ?, updated_at = datetime('now') WHERE store_name = ? AND record_id = ?"
  ).run(JSON.stringify(data), store, id);
  return result.changes > 0;
}

/** 删除记录 */
export function dbDelete(db: Database.Database, store: string, id: string): boolean {
  const result = db.prepare("DELETE FROM sync_data WHERE store_name = ? AND record_id = ?").run(store, id);
  return result.changes > 0;
}

/** 清空指定 store 的所有记录 */
export function dbClearStore(db: Database.Database, store: string): number {
  const result = db.prepare("DELETE FROM sync_data WHERE store_name = ?").run(store);
  return result.changes;
}

/** 清空所有记录 */
export function dbClearAll(db: Database.Database): void {
  db.exec("DELETE FROM sync_data");
  db.exec("DELETE FROM sync_meta");
}
