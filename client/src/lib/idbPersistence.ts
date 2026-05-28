/**
 * Unified IDB persistence helper for Zustand slices.
 *
 * Problem: 3 different persistence patterns exist in the codebase:
 * 1. Fire-and-forget IDB writes in actions (caseSlice, documentsSlice, referencesSlice)
 * 2. Load-only protection (novelty, inventive, defects use load* methods)
 * 3. No persistence at all
 *
 * Solution: Provide a consistent helper that slices can use for IDB writes.
 * Hydration (load*) methods should NOT use this — they call set* directly.
 *
 * Usage in a slice action:
 *   persistToIDB("documents", doc, "put");
 *   persistToIDB("documents", id, "delete");
 */
import { getDB } from "./indexedDb";
import { createLogger } from "./logger";

const log = createLogger("IDB-Persist");

type IDBStoreName =
  | "cases"
  | "documents"
  | "claimNodes"
  | "claimCharts"
  | "novelty"
  | "inventive"
  | "defects"
  | "chatSessions"
  | "chatMessages"
  | "opinionAnalyses"
  | "argumentMappings"
  | "reexamDrafts"
  | "summaries"
  | "settings"
  | "feedback"
  | "runMarkers"
  | "searchSessions"
  | "interpretSummaries"
  | "ocrCache"
  | "textIndex";

/**
 * Fire-and-forget IDB write. Errors are logged but not thrown.
 * Use this in Zustand slice actions for non-critical persistence.
 */
export function persistToIDB(
  storeName: IDBStoreName,
  data: unknown,
  operation: "put" | "delete" = "put"
): void {
  const doWrite = async () => {
    try {
      const db = await getDB();
      if (operation === "put") {
        await db.put(storeName, data as never);
      } else {
        await db.delete(storeName, data as string);
      }
    } catch (e) {
      log(`IDB ${operation} failed for ${storeName}:`, e);
    }
  };
  doWrite();
}
