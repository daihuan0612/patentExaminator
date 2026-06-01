import { query } from "../dataClient";
import type { SourceDocument } from "@shared/types/domain";

// ReferenceDocument extends SourceDocument; stored in the same "documents" store
// with role="reference"

export async function readReferencesByCaseId(caseId: string): Promise<SourceDocument[]> {
  const all = await query<SourceDocument>("documents", "caseId", caseId);
  return all.filter((doc) => doc.role === "reference");
}
