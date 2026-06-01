import { create, query, update, remove } from "../dataClient";
import type { FormalDefect } from "@shared/types/domain";

export async function createDefect(defect: FormalDefect): Promise<void> {
  await create("defects", defect as FormalDefect & { id: string });
}

export async function getDefectsByCaseId(caseId: string): Promise<FormalDefect[]> {
  return query<FormalDefect>("defects", "caseId", caseId);
}

export async function updateDefect(defect: FormalDefect): Promise<void> {
  await update("defects", defect.id, defect);
}

export async function deleteDefect(id: string): Promise<void> {
  await remove("defects", id);
}

export async function deleteDefectsByCaseId(caseId: string): Promise<void> {
  const items = await query<FormalDefect>("defects", "caseId", caseId);
  for (const item of items) {
    await remove("defects", item.id);
  }
}
