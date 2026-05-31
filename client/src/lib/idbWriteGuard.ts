/**
 * Guard for IndexedDB write operations.
 * Shows a toast notification on failure so users know data wasn't persisted.
 * Designed for fire-and-forget usage: .catch(idbWriteGuard("context"))
 */
import { showToast } from "./toast";
import { createLogger } from "./logger";

const log = createLogger("idbWriteGuard");

/**
 * Returns an error handler that logs + shows toast.
 * Does NOT re-throw — keeps the fire-and-forget pattern.
 *
 * Usage: writeSettings(settings).catch(idbWriteGuard("settings"))
 */
export function idbWriteGuard(context: string): (err: unknown) => void {
  return (err: unknown) => {
    log("IDB write failed:", context, err);
    showToast(`数据保存失败（${context}），刷新页面后可能丢失`, "error", 8000);
  };
}
