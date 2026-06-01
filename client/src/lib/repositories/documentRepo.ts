import { create, getAll, getById, update, remove } from "../dataClient.js";
import type { SourceDocument } from "@shared/types/domain";

export async function createDocument(item: SourceDocument): Promise<void> {
  await create("documents", item);
}

export async function readAllDocuments(): Promise<SourceDocument[]> {
  return getAll<SourceDocument>("documents");
}

export async function readDocumentsByCaseId(caseId: string): Promise<SourceDocument[]> {
  const docs = await getAll<SourceDocument>("documents");
  return docs.filter((d) => d.caseId === caseId);
}

export async function readDocumentById(id: string): Promise<SourceDocument | undefined> {
  const result = await getById<SourceDocument>("documents", id);
  return result ?? undefined;
}

export async function updateDocument(item: SourceDocument): Promise<void> {
  await update("documents", item.id, item);
}

export async function deleteDocument(id: string): Promise<void> {
  await remove("documents", id);
}
