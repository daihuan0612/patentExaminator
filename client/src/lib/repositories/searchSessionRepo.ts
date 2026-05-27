import { getDB } from "../indexedDb";
import type { SearchSession } from "@shared/types/domain";

export async function createSearchSession(session: SearchSession): Promise<void> {
  const db = await getDB();
  await db.put("searchSessions", session);
}

export async function getSearchSessionsByCaseId(caseId: string): Promise<SearchSession[]> {
  const db = await getDB();
  return db.getAllFromIndex("searchSessions", "by-caseId", caseId);
}

export async function updateSearchSession(session: SearchSession): Promise<void> {
  const db = await getDB();
  await db.put("searchSessions", { ...session, updatedAt: new Date().toISOString() });
}

export async function deleteSearchSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("searchSessions", id);
}

export async function getLatestSearchSession(caseId: string): Promise<SearchSession | undefined> {
  const sessions = await getSearchSessionsByCaseId(caseId);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
