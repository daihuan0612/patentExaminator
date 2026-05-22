import { getDB } from "../indexedDb.js";
import type {
  OfficeActionAnalysis,
  ArgumentMapping
} from "@shared/types/domain";

/**
 * Save office action analysis to IndexedDB.
 * Uses caseId as the primary key (one analysis per case).
 */
export async function saveOpinionAnalysis(
  analysis: OfficeActionAnalysis
): Promise<void> {
  const db = await getDB();
  await db.put("opinionAnalyses", analysis);
}

/**
 * Read office action analysis for a case from IndexedDB.
 * Returns null if no analysis exists for the case.
 */
export async function readOpinionAnalysis(
  caseId: string
): Promise<OfficeActionAnalysis | null> {
  const db = await getDB();
  const analyses = await db.getAllFromIndex("opinionAnalyses", "by-caseId", caseId);
  // Return the most recent one if multiple exist
  if (analyses.length === 0) return null;
  // Sort by createdAt descending and return the latest
  analyses.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return analyses[0] ?? null;
}

/**
 * Delete office action analysis for a case.
 */
export async function deleteOpinionAnalysis(caseId: string): Promise<void> {
  const db = await getDB();
  const analyses = await db.getAllFromIndex("opinionAnalyses", "by-caseId", caseId);
  for (const analysis of analyses) {
    await db.delete("opinionAnalyses", analysis.id);
  }
}

/**
 * Save argument mappings to IndexedDB.
 * Clears existing mappings for the case before saving new ones.
 */
export async function saveArgumentMappings(
  mappings: ArgumentMapping[]
): Promise<void> {
  const db = await getDB();
  for (const mapping of mappings) {
    await db.put("argumentMappings", mapping);
  }
}

/**
 * Read argument mappings for a case from IndexedDB.
 */
export async function readArgumentMappings(
  caseId: string
): Promise<ArgumentMapping[]> {
  const db = await getDB();
  return db.getAllFromIndex("argumentMappings", "by-caseId", caseId);
}

/**
 * Delete all argument mappings for a case.
 */
export async function deleteArgumentMappings(caseId: string): Promise<void> {
  const db = await getDB();
  const mappings = await db.getAllFromIndex("argumentMappings", "by-caseId", caseId);
  for (const mapping of mappings) {
    await db.delete("argumentMappings", mapping.id);
  }
}

/**
 * Clear all opinion-related data for a case.
 */
export async function clearOpinionData(caseId: string): Promise<void> {
  await deleteOpinionAnalysis(caseId);
  await deleteArgumentMappings(caseId);
}