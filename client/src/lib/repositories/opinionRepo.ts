import { create, query, remove } from "../dataClient";
import type {
  OfficeActionAnalysis,
  ArgumentMapping
} from "@shared/types/domain";

/**
 * Save office action analysis.
 * Uses caseId as the primary key (one analysis per case).
 */
export async function saveOpinionAnalysis(
  analysis: OfficeActionAnalysis
): Promise<void> {
  await create("opinionAnalyses", analysis as OfficeActionAnalysis & { id: string });
}

/**
 * Read office action analysis for a case.
 * Returns null if no analysis exists for the case.
 */
export async function readOpinionAnalysis(
  caseId: string
): Promise<OfficeActionAnalysis | null> {
  const analyses = await query<OfficeActionAnalysis>("opinionAnalyses", "caseId", caseId);
  if (analyses.length === 0) return null;
  analyses.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return analyses[0] ?? null;
}

/**
 * Delete office action analysis for a case.
 */
export async function deleteOpinionAnalysis(caseId: string): Promise<void> {
  const analyses = await query<OfficeActionAnalysis>("opinionAnalyses", "caseId", caseId);
  for (const analysis of analyses) {
    await remove("opinionAnalyses", analysis.id);
  }
}

/**
 * Save argument mappings.
 * Clears existing mappings for the case before saving new ones.
 */
export async function saveArgumentMappings(
  mappings: ArgumentMapping[]
): Promise<void> {
  for (const mapping of mappings) {
    await create("argumentMappings", mapping as ArgumentMapping & { id: string });
  }
}

/**
 * Read argument mappings for a case.
 */
export async function readArgumentMappings(
  caseId: string
): Promise<ArgumentMapping[]> {
  return query<ArgumentMapping>("argumentMappings", "caseId", caseId);
}

/**
 * Delete all argument mappings for a case.
 */
export async function deleteArgumentMappings(caseId: string): Promise<void> {
  const mappings = await query<ArgumentMapping>("argumentMappings", "caseId", caseId);
  for (const mapping of mappings) {
    await remove("argumentMappings", mapping.id);
  }
}

/**
 * Clear all opinion-related data for a case.
 */
export async function clearOpinionData(caseId: string): Promise<void> {
  await deleteOpinionAnalysis(caseId);
  await deleteArgumentMappings(caseId);
}
