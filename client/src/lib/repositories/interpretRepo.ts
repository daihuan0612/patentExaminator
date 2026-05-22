import { getDB } from "../indexedDb.js";

interface InterpretSummaryRecord {
  caseId: string;
  summary: string;
  updatedAt: string;
}

export async function saveInterpretSummary(caseId: string, summary: string): Promise<void> {
  const db = await getDB();
  const record: InterpretSummaryRecord = {
    caseId,
    summary,
    updatedAt: new Date().toISOString()
  };
  await db.put("interpretSummaries", record);
}

export async function readInterpretSummary(caseId: string): Promise<string | undefined> {
  const db = await getDB();
  const record = await db.get("interpretSummaries", caseId);
  return record?.summary;
}

export async function deleteInterpretSummary(caseId: string): Promise<void> {
  const db = await getDB();
  await db.delete("interpretSummaries", caseId);
}