/**
 * 全局 setup/teardown — B-042: 测试数据库隔离机制
 *
 * 确保测试后清理所有临时数据库文件，即使测试崩溃也能执行。
 * 在 vitest.integration.config.ts 中通过 globalSetup 配置。
 */
import { cleanupAllTrackedFiles } from "./helpers/testDb.js";

/** 全局 teardown：清理所有临时文件 */
export function teardown(): void {
  cleanupAllTrackedFiles();

  // 清理测试注入的全局变量
  delete (globalThis as Record<string, unknown>).__TEST_SYNC_DB_PATH__;
}
