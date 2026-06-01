import { create, query, update, remove } from "../dataClient";
import type { ClaimNode, ClaimFeature } from "@shared/types/domain";

// ClaimNode operations
export async function createClaimNode(item: ClaimNode): Promise<void> {
  await create("claimNodes", item as ClaimNode & { id: string });
}

export async function readClaimNodesByCaseId(caseId: string): Promise<ClaimNode[]> {
  return query<ClaimNode>("claimNodes", "caseId", caseId);
}

export async function deleteClaimNode(id: string): Promise<void> {
  await remove("claimNodes", id);
}

// ClaimFeature (claimChart) operations
export async function createClaimFeature(item: ClaimFeature): Promise<void> {
  await create("claimCharts", item as ClaimFeature & { id: string });
}

export async function readClaimFeaturesByCaseId(caseId: string): Promise<ClaimFeature[]> {
  return query<ClaimFeature>("claimCharts", "caseId", caseId);
}

export async function readClaimFeaturesByClaimNumber(
  caseId: string,
  claimNumber: number
): Promise<ClaimFeature[]> {
  const all = await query<ClaimFeature>("claimCharts", "claimNumber", claimNumber);
  return all.filter((f) => f.claimNumber === claimNumber && f.id.startsWith(caseId));
}

export async function updateClaimFeature(item: ClaimFeature): Promise<void> {
  await update("claimCharts", item.id, item);
}

export async function deleteClaimFeature(id: string): Promise<void> {
  await remove("claimCharts", id);
}

/**
 * Delete all claim features for a case.
 * Used when clearing case data or re-generating claim chart.
 */
export async function deleteClaimFeaturesByCaseId(caseId: string): Promise<void> {
  const features = await query<ClaimFeature>("claimCharts", "caseId", caseId);
  for (const feature of features) {
    await remove("claimCharts", feature.id);
  }
}
