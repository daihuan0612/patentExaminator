import { create, query, update, remove } from "../dataClient";
import type { SearchSession } from "@shared/types/domain";

export async function createSearchSession(session: SearchSession): Promise<void> {
  await create("searchSessions", session as SearchSession & { id: string });
}

export async function getSearchSessionsByCaseId(caseId: string): Promise<SearchSession[]> {
  return query<SearchSession>("searchSessions", "caseId", caseId);
}

export async function updateSearchSession(session: SearchSession): Promise<void> {
  await update("searchSessions", session.id, { ...session, updatedAt: new Date().toISOString() });
}

export async function deleteSearchSession(id: string): Promise<void> {
  await remove("searchSessions", id);
}

export async function getLatestSearchSession(caseId: string): Promise<SearchSession | undefined> {
  const sessions = await getSearchSessionsByCaseId(caseId);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
