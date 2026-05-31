/**
 * 知识库 Repository — IndexedDB CRUD 操作
 */
import { getDB } from "../indexedDb";
import type { KnowledgeSource, KnowledgeChunk, KnowledgeVector } from "@shared/types/knowledge";
import { createLogger } from "../logger";

const log = createLogger("KnowledgeRepo");

// ── KnowledgeSource ──────────────────────────────────

export async function addSource(source: KnowledgeSource): Promise<void> {
  const db = await getDB();
  await db.put("knowledgeSources", source);
  log(`Added source: ${source.id} (${source.name})`);
}

export async function getSource(id: string): Promise<KnowledgeSource | undefined> {
  const db = await getDB();
  return db.get("knowledgeSources", id);
}

export async function getAllSources(): Promise<KnowledgeSource[]> {
  const db = await getDB();
  return db.getAll("knowledgeSources");
}

export async function deleteSource(id: string): Promise<void> {
  const db = await getDB();
  // 删除关联的 chunks 和 vectors
  const chunks = await db.getAllFromIndex("knowledgeChunks", "by-sourceId", id);
  for (const chunk of chunks) {
    await db.delete("knowledgeVectors", chunk.id);
  }
  await db.delete("knowledgeSources", id);
  // 删除关联的 chunks
  const tx = db.transaction("knowledgeChunks", "readwrite");
  const index = tx.store.index("by-sourceId");
  let cursor = await index.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  log(`Deleted source: ${id}`);
}

// ── KnowledgeChunk ───────────────────────────────────

export async function addChunks(chunks: KnowledgeChunk[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("knowledgeChunks", "readwrite");
  for (const chunk of chunks) {
    await tx.store.put(chunk);
  }
  await tx.done;
  log(`Added ${chunks.length} chunks`);
}

export async function getChunksBySource(sourceId: string): Promise<KnowledgeChunk[]> {
  const db = await getDB();
  return db.getAllFromIndex("knowledgeChunks", "by-sourceId", sourceId);
}

export async function getUnembeddedChunks(): Promise<KnowledgeChunk[]> {
  const db = await getDB();
  return db.getAllFromIndex("knowledgeChunks", "by-embedded", 0);
}

export async function markChunkEmbedded(chunkId: string): Promise<void> {
  const db = await getDB();
  const chunk = await db.get("knowledgeChunks", chunkId);
  if (chunk) {
    chunk.embedded = true;
    await db.put("knowledgeChunks", chunk);
  }
}

export async function deleteChunksBySource(sourceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("knowledgeChunks", "readwrite");
  const index = tx.store.index("by-sourceId");
  let cursor = await index.openCursor(sourceId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ── KnowledgeVector ──────────────────────────────────

export async function addVectors(vectors: KnowledgeVector[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("knowledgeVectors", "readwrite");
  for (const vec of vectors) {
    await tx.store.put(vec);
  }
  await tx.done;
  log(`Added ${vectors.length} vectors`);
}

export async function getVector(chunkId: string): Promise<KnowledgeVector | undefined> {
  const db = await getDB();
  return db.get("knowledgeVectors", chunkId);
}

export async function getAllVectors(): Promise<KnowledgeVector[]> {
  const db = await getDB();
  return db.getAll("knowledgeVectors");
}

export async function deleteVectorsBySource(sourceId: string): Promise<void> {
  const db = await getDB();
  const chunks = await db.getAllFromIndex("knowledgeChunks", "by-sourceId", sourceId);
  const tx = db.transaction("knowledgeVectors", "readwrite");
  for (const chunk of chunks) {
    await tx.store.delete(chunk.id);
  }
  await tx.done;
}

// ── 统计 ─────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<{
  sourceCount: number;
  chunkCount: number;
  embeddedCount: number;
}> {
  const db = await getDB();
  const sources = await db.count("knowledgeSources");
  const chunks = await db.count("knowledgeChunks");
  const vectors = await db.count("knowledgeVectors");
  return { sourceCount: sources, chunkCount: chunks, embeddedCount: vectors };
}

// ── 一致性校验 ─────────────────────────────────────────

export interface ConsistencyReport {
  orphanedChunks: string[];   // 有 chunk 无 vector
  orphanedVectors: string[];  // 有 vector 无 chunk
  isConsistent: boolean;
}

/** 检查 chunk 和 vector 的一致性 */
export async function checkConsistency(): Promise<ConsistencyReport> {
  const db = await getDB();
  const chunks = await db.getAll("knowledgeChunks");
  const vectors = await db.getAll("knowledgeVectors");

  const chunkIds = new Set(chunks.map((c) => c.id));
  const vectorIds = new Set(vectors.map((v) => v.chunkId));

  const orphanedChunks = chunks.filter((c) => !vectorIds.has(c.id)).map((c) => c.id);
  const orphanedVectors = vectors.filter((v) => !chunkIds.has(v.chunkId)).map((v) => v.chunkId);

  return {
    orphanedChunks,
    orphanedVectors,
    isConsistent: orphanedChunks.length === 0 && orphanedVectors.length === 0,
  };
}

/** 修复不一致：删除孤立的 vector */
export async function fixConsistency(): Promise<ConsistencyReport> {
  const report = await checkConsistency();
  if (report.isConsistent) return report;

  const db = await getDB();
  const tx = db.transaction("knowledgeVectors", "readwrite");
  for (const vectorId of report.orphanedVectors) {
    await tx.store.delete(vectorId);
  }
  await tx.done;

  log(`Fixed consistency: removed ${report.orphanedVectors.length} orphaned vectors`);
  return { ...report, orphanedVectors: [], isConsistent: report.orphanedChunks.length === 0 };
}

// ── 存储空间 ──────────────────────────────────────────

export interface StorageEstimate {
  sourceCount: number;
  chunkCount: number;
  vectorCount: number;
  estimatedBytes: number;
  estimatedMB: string;
}

/** 估算知识库存储占用 */
export async function estimateStorage(): Promise<StorageEstimate> {
  const db = await getDB();
  const sources = await db.getAll("knowledgeSources");
  const chunks = await db.getAll("knowledgeChunks");
  const vectors = await db.getAll("knowledgeVectors");

  let totalBytes = 0;
  for (const chunk of chunks) {
    totalBytes += chunk.text.length * 3; // UTF-8 中文约 3 字节/字符
  }
  for (const vec of vectors) {
    totalBytes += vec.vector.length * 8; // float64 = 8 bytes
  }
  for (const source of sources) {
    totalBytes += 500; // 元数据约 500 字节
  }

  return {
    sourceCount: sources.length,
    chunkCount: chunks.length,
    vectorCount: vectors.length,
    estimatedBytes: totalBytes,
    estimatedMB: (totalBytes / 1024 / 1024).toFixed(2),
  };
}

// ── 导入/导出 ─────────────────────────────────────────

export interface KnowledgeExportData {
  version: 1;
  exportedAt: string;
  sources: KnowledgeSource[];
  chunks: KnowledgeChunk[];
  vectors: KnowledgeVector[];
}

/** 导出全部知识库数据为 JSON */
export async function exportKnowledge(): Promise<KnowledgeExportData> {
  const db = await getDB();
  const sources = await db.getAll("knowledgeSources");
  const chunks = await db.getAll("knowledgeChunks");
  const vectors = await db.getAll("knowledgeVectors");
  return { version: 1, exportedAt: new Date().toISOString(), sources, chunks, vectors };
}

/** 从 JSON 导入知识库数据（合并模式，不覆盖已有） */
export async function importKnowledge(data: KnowledgeExportData): Promise<{
  importedSources: number;
  importedChunks: number;
  importedVectors: number;
}> {
  const db = await getDB();

  // 获取已有 ID
  const existingSources = new Set((await db.getAll("knowledgeSources")).map((s) => s.id));
  const existingChunks = new Set((await db.getAll("knowledgeChunks")).map((c) => c.id));
  const existingVectors = new Set((await db.getAll("knowledgeVectors")).map((v) => v.chunkId));

  let importedSources = 0;
  let importedChunks = 0;
  let importedVectors = 0;

  const tx = db.transaction(
    ["knowledgeSources", "knowledgeChunks", "knowledgeVectors"],
    "readwrite"
  );

  for (const source of data.sources) {
    if (!existingSources.has(source.id)) {
      await tx.objectStore("knowledgeSources").put(source);
      importedSources++;
    }
  }
  for (const chunk of data.chunks) {
    if (!existingChunks.has(chunk.id)) {
      await tx.objectStore("knowledgeChunks").put(chunk);
      importedChunks++;
    }
  }
  for (const vec of data.vectors) {
    if (!existingVectors.has(vec.chunkId)) {
      await tx.objectStore("knowledgeVectors").put(vec);
      importedVectors++;
    }
  }

  await tx.done;
  log(`Imported: ${importedSources} sources, ${importedChunks} chunks, ${importedVectors} vectors`);
  return { importedSources, importedChunks, importedVectors };
}

// ── 清空 ─────────────────────────────────────────────

export async function clearAllKnowledge(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["knowledgeSources", "knowledgeChunks", "knowledgeVectors"],
    "readwrite"
  );
  await tx.objectStore("knowledgeSources").clear();
  await tx.objectStore("knowledgeChunks").clear();
  await tx.objectStore("knowledgeVectors").clear();
  await tx.done;
  log("Cleared all knowledge data");
}
