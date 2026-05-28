/**
 * Centralized logger that respects build mode.
 * In production (import.meta.env.DEV = false), all debug logs are no-ops.
 * Usage: import { createLogger } from "../lib/logger";
 *        const log = createLogger("MyModule");
 *        log("some debug info"); // only logs in dev mode
 */
export function createLogger(tag: string): (...args: unknown[]) => void {
  if (import.meta.env.DEV) {
    return (...args: unknown[]) => console.log(`[${tag}]`, ...args);
  }
  return () => {}; // no-op in production
}
