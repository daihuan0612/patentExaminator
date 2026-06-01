import { create, getAll, getById, query, update, remove } from "../dataClient";
import type { InventiveStepAnalysis } from "@shared/types/domain";

export async function createInventive(item: InventiveStepAnalysis): Promise<void> {
  await create("inventive", item as InventiveStepAnalysis & { id: string });
}

export async function readAllInventive(): Promise<InventiveStepAnalysis[]> {
  return getAll<InventiveStepAnalysis>("inventive");
}

export async function readInventiveByCaseId(caseId: string): Promise<InventiveStepAnalysis[]> {
  return query<InventiveStepAnalysis>("inventive", "caseId", caseId);
}

export async function readInventiveById(id: string): Promise<InventiveStepAnalysis | undefined> {
  const result = await getById<InventiveStepAnalysis>("inventive", id);
  return result ?? undefined;
}

export async function updateInventive(item: InventiveStepAnalysis): Promise<void> {
  await update("inventive", item.id, item);
}

export async function deleteInventive(id: string): Promise<void> {
  await remove("inventive", id);
}

export async function deleteInventiveByCaseId(caseId: string): Promise<void> {
  const items = await query<InventiveStepAnalysis>("inventive", "caseId", caseId);
  for (const item of items) {
    await remove("inventive", item.id);
  }
}
