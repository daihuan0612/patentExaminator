import { create, getById, remove } from "../dataClient";

interface InterpretSummariesRecord {
  caseId: string;
  summaries: Record<string, string>;
  updatedAt: string;
}

interface LegacyInterpretSummaryRecord {
  caseId: string;
  summary: string;
  updatedAt: string;
}

type InterpretSummaryRecord = LegacyInterpretSummaryRecord | InterpretSummariesRecord;

export async function saveInterpretSummaries(
  caseId: string,
  summaries: Record<string, string>
): Promise<void> {
  const record: InterpretSummariesRecord = {
    caseId,
    summaries,
    updatedAt: new Date().toISOString()
  };
  await create("interpretSummaries", { id: caseId, ...record });
}

export async function readInterpretSummaries(caseId: string): Promise<Record<string, string>> {
  const record = await getById<InterpretSummaryRecord>("interpretSummaries", caseId);
  if (!record) return {};
  if ("summaries" in record) {
    return record.summaries;
  }
  return record.summary ? { __legacy__: record.summary } : {};
}

export async function deleteInterpretSummaries(caseId: string): Promise<void> {
  await remove("interpretSummaries", caseId);
}
