import { create, getAll, query, update, remove } from "../dataClient";
import type { FeedbackItem } from "@shared/types/feedback";

export async function createFeedback(item: FeedbackItem): Promise<void> {
  await create("feedback", item as FeedbackItem & { id: string });
}

export async function readAllFeedback(): Promise<FeedbackItem[]> {
  return getAll<FeedbackItem>("feedback");
}

export async function readFeedbackByCaseId(caseId: string): Promise<FeedbackItem[]> {
  return query<FeedbackItem>("feedback", "caseId", caseId);
}

export async function updateFeedback(item: FeedbackItem): Promise<void> {
  await update("feedback", item.id, item);
}

export async function deleteFeedback(id: string): Promise<void> {
  await remove("feedback", id);
}
