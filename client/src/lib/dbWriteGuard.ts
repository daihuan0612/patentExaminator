/**
 * Guard for DB write operations.
 * Shows a toast notification on failure so users know data wasn't persisted.
 * Designed for fire-and-forget usage: .catch(dbWriteGuard("context"))
 */
import { showToast } from "./toast";
import { createLogger } from "./logger";

const log = createLogger("dbWriteGuard");

/**
 * Returns an error handler that logs + shows toast.
 * Does NOT re-throw — keeps the fire-and-forget pattern.
 *
 * Usage: writeSettings(settings).catch(dbWriteGuard("settings"))
 */
export function dbWriteGuard(context: string): (err: unknown) => void {
  return (err: unknown) => {
    log("DB write failed:", context, err);
    showToast(`数据保存失败（${context}），刷新页面后可能丢失`, "error", 8000);
  };
}
