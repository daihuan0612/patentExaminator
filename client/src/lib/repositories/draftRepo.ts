import { create, getById, remove } from "../dataClient";
import type { ReexamDraftResponse, SummaryResponse } from "../../agent/contracts.js";

const DRAFT_STORE = "reexamDrafts";
const SUMMARY_STORE = "summaries";

export async function saveReexamDraft(caseId: string, draft: ReexamDraftResponse): Promise<void> {
  await create(DRAFT_STORE, { id: caseId, ...draft });
}

export async function readReexamDraft(caseId: string): Promise<ReexamDraftResponse | undefined> {
  const record = await getById<Record<string, unknown>>(DRAFT_STORE, caseId);
  if (!record) return undefined;
  const { id: _id, ...rest } = record as { id: string; [key: string]: unknown };
  return rest as unknown as ReexamDraftResponse;
}

export async function deleteReexamDraft(caseId: string): Promise<void> {
  await remove(DRAFT_STORE, caseId);
}

export async function saveSummary(caseId: string, summary: SummaryResponse): Promise<void> {
  await create(SUMMARY_STORE, { id: caseId, ...summary });
}

export async function readSummary(caseId: string): Promise<SummaryResponse | undefined> {
  const record = await getById<Record<string, unknown>>(SUMMARY_STORE, caseId);
  if (!record) return undefined;
  const { id: _id, ...rest } = record as { id: string; [key: string]: unknown };
  return rest as unknown as SummaryResponse;
}

export async function deleteSummary(caseId: string): Promise<void> {
  await remove(SUMMARY_STORE, caseId);
}

export async function clearDraftData(caseId: string): Promise<void> {
  await deleteReexamDraft(caseId);
  await deleteSummary(caseId);
}
