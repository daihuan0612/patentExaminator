/**
 * BM25 关键词检索 — 使用 minisearch 实现
 */
import MiniSearch from "minisearch";
import type { KnowledgeChunk } from "@shared/types/knowledge";
import { createLogger } from "../logger";

const log = createLogger("BM25Search");

let miniSearch: MiniSearch | null = null;
let indexedSourceIds = new Set<string>();

/** 构建或更新 BM25 索引 */
export function buildBM25Index(chunks: KnowledgeChunk[]): void {
  const newChunks = chunks.filter((c) => !indexedSourceIds.has(c.sourceId));

  if (newChunks.length === 0 && miniSearch) {
    log("BM25 index up to date");
    return;
  }

  // 重建索引（minisearch 不支持增量添加，但对我们的规模足够快）
  miniSearch = new MiniSearch({
    fields: ["text"],
    storeFields: ["sourceId", "metadata"],
    searchOptions: {
      boost: { text: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const documents = chunks.map((c) => ({
    id: c.id,
    text: c.text,
    sourceId: c.sourceId,
    metadata: JSON.stringify(c.metadata),
  }));

  miniSearch.addAll(documents);
  indexedSourceIds = new Set(chunks.map((c) => c.sourceId));
  log(`BM25 index built: ${chunks.length} documents`);
}

/** BM25 关键词检索 */
export function searchBM25(
  query: string,
  topK: number = 10
): Array<{ id: string; score: number }> {
  if (!miniSearch) {
    log("BM25 index not built");
    return [];
  }

  const results = miniSearch.search(query, { limit: topK });
  return results.map((r) => ({ id: String(r.id), score: r.score }));
}

/** 清除 BM25 索引 */
export function invalidateBM25Index(): void {
  miniSearch = null;
  indexedSourceIds = new Set();
}
