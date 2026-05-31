/**
 * 混合检索 — 语义检索 + BM25 关键词检索，RRF 融合排序
 */
import type { KnowledgeSearchResult, KnowledgeConfig } from "@shared/types/knowledge";
import type { EmbedderConfig } from "./embedder";
import { embedSingle } from "./embedder";
import { searchKnowledge } from "./vectorStore";
import { searchBM25, buildBM25Index } from "./bm25Search";
import { getKnowledgeStats } from "./knowledgeRepo";
import { expandQuery } from "./normalizers";
import { createLogger } from "../logger";

const log = createLogger("HybridSearch");

const RRF_K = 60; // RRF 常数，标准值为 60

/** Reciprocal Rank Fusion：融合多个排序列表 */
function reciprocalRankFusion(
  rankings: Array<Array<{ id: string; score: number }>>,
  k: number = RRF_K
): Array<{ id: string; score: number }> {
  const scoreMap = new Map<string, number>();

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const { id } = ranking[rank]!;
      const rrfScore = 1 / (k + rank + 1);
      scoreMap.set(id, (scoreMap.get(id) ?? 0) + rrfScore);
    }
  }

  return Array.from(scoreMap.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/** 混合检索：语义 + BM25，RRF 融合 */
export async function hybridSearch(
  query: string,
  config: KnowledgeConfig,
  embedConfig: EmbedderConfig,
  topK: number = 5
): Promise<KnowledgeSearchResult[]> {
  const stats = await getKnowledgeStats();
  if (!config.enabled || stats.chunkCount === 0 || stats.embeddedCount === 0) {
    return [];
  }

  const expandedQuery = expandQuery(query);

  // 语义检索
  const queryVector = await embedSingle(expandedQuery, embedConfig);
  const semanticResults = await searchKnowledge(queryVector, topK * 2, config.scoreThreshold);
  const semanticRanking = semanticResults.map((r) => ({ id: r.chunk.id, score: r.score }));

  // BM25 检索
  const bm25Results = searchBM25(expandedQuery, topK * 2);
  const bm25Ranking = bm25Results.map((r) => ({ id: r.id, score: r.score }));

  // RRF 融合
  const fusedRanking = reciprocalRankFusion([semanticRanking, bm25Ranking]);

  // 取 top-K 并映射回 KnowledgeSearchResult
  const semanticMap = new Map(semanticResults.map((r) => [r.chunk.id, r]));
  const results: KnowledgeSearchResult[] = [];

  for (const { id } of fusedRanking.slice(0, topK)) {
    const semanticResult = semanticMap.get(id);
    if (semanticResult) {
      results.push(semanticResult);
    }
  }

  log(`Hybrid search: ${semanticResults.length} semantic + ${bm25Results.length} BM25 → ${results.length} fused results`);
  return results;
}
