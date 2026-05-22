import { getDB } from "../indexedDb";
import type { FormalDefect } from "@shared/types/domain";

export async function createDefect(defect: FormalDefect): Promise<void> {
  const db = await getDB();
  await db.put("defects", defect);
}

export async function getDefectsByCaseId(caseId: string): Promise<FormalDefect[]> {
  const db = await getDB();
  return db.getAllFromIndex("defects", "by-caseId", caseId);
}

export async function updateDefect(defect: FormalDefect): Promise<void> {
  const db = await getDB();
  await db.put("defects", defect);
}

export async function deleteDefect(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("defects", id);
}

export async function deleteDefectsByCaseId(caseId: string): Promise<void> {
  const db = await getDB();
  const items = await db.getAllFromIndex("defects", "by-caseId", caseId);
  for (const item of items) {
    await db.delete("defects", item.id);
  }
}