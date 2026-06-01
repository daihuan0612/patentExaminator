import { create, getAll, getById, update, remove } from "../dataClient.js";
import type { PatentCase } from "@shared/types/domain";

export async function createCase(item: PatentCase): Promise<void> {
  await create("cases", item);
}

export async function readAllCases(): Promise<PatentCase[]> {
  const cases = await getAll<PatentCase>("cases");
  return cases.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function readCaseById(id: string): Promise<PatentCase | undefined> {
  const result = await getById<PatentCase>("cases", id);
  return result ?? undefined;
}

export async function updateCase(item: PatentCase): Promise<void> {
  await update("cases", item.id, { ...item, updatedAt: new Date().toISOString() });
}

export async function deleteCase(id: string): Promise<void> {
  await remove("cases", id);
}
