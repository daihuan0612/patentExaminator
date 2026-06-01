import { create, getAll, getById, query, update, remove } from "../dataClient";
import type { NoveltyComparison } from "@shared/types/domain";

export async function createNovelty(item: NoveltyComparison): Promise<void> {
  await create("novelty", item as NoveltyComparison & { id: string });
}

export async function readAllNovelty(): Promise<NoveltyComparison[]> {
  return getAll<NoveltyComparison>("novelty");
}

export async function readNoveltyByCaseId(caseId: string): Promise<NoveltyComparison[]> {
  return query<NoveltyComparison>("novelty", "caseId", caseId);
}

export async function readNoveltyById(id: string): Promise<NoveltyComparison | undefined> {
  const result = await getById<NoveltyComparison>("novelty", id);
  return result ?? undefined;
}

export async function updateNovelty(item: NoveltyComparison): Promise<void> {
  await update("novelty", item.id, item);
}

export async function deleteNovelty(id: string): Promise<void> {
  await remove("novelty", id);
}

export async function deleteNoveltyByCaseId(caseId: string): Promise<void> {
  const items = await query<NoveltyComparison>("novelty", "caseId", caseId);
  for (const item of items) {
    await remove("novelty", item.id);
  }
}
