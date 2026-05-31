/**
 * 知识库检索器 — 将用户 query 向量化后检索相关 chunk
 */
import type { KnowledgeSearchResult, KnowledgeConfig } from "@shared/types/knowledge";
import type { EmbedderConfig } from "./embedder";
import { embedSingle } from "./embedder";
import { searchKnowledge } from "./vectorStore";
import { getKnowledgeStats } from "./knowledgeRepo";
import { expandQuery } from "./normalizers";
import { hybridSearch } from "./hybridSearch";
import { createLogger } from "../logger";

const log = createLogger("KnowledgeRetriever");

export interface RetrieveOptions {
  query: string;
  topK?: number;
  scoreThreshold?: number;
}

/**
 * 检索与 query 最相关的知识库 chunk
 */
export async function retrieve(
  options: RetrieveOptions,
  config: KnowledgeConfig,
  embedConfig: EmbedderConfig
): Promise<KnowledgeSearchResult[]> {
  const { query, topK = config.topK, scoreThreshold = config.scoreThreshold } = options;

  // 检查知识库是否启用且有内容
  const stats = await getKnowledgeStats();
  if (!config.enabled || stats.chunkCount === 0 || stats.embeddedCount === 0) {
    log("Knowledge base disabled or empty, skipping retrieval");
    return [];
  }

  // 使用混合检索（语义 + BM25 RRF 融合）
  const results = await hybridSearch(query, config, embedConfig, topK);

  log(`Retrieved ${results.length} chunks via hybrid search`);

  return results;
}

/**
 * 将检索结果格式化为 Prompt 注入文本
 * @param maxTokens 最大 token 预算（约 1 token ≈ 1.5 中文字符），超出时截断
 */
export function formatRetrievedChunks(results: KnowledgeSearchResult[], maxTokens?: number): string {
  if (results.length === 0) return "";

  const parts = [
    `## 参考法规（由知识库检索，仅供参考）`,
    `以下段落与当前分析内容相关，请在回答时参考但不仅限于此：`,
    ``,
  ];

  let totalChars = 0;
  const charLimit = maxTokens ? Math.floor(maxTokens * 1.5) : Infinity;

  for (const result of results) {
    const { chunk, score } = result;
    const { metadata } = chunk;

    // 构造此 chunk 的注入文本
    const sourceLabel = metadata.sectionId
      ? `${metadata.fileName} ${metadata.sectionId}`
      : metadata.articleId
        ? `${metadata.fileName} ${metadata.articleId}`
        : metadata.sheetName
          ? `${metadata.fileName} - ${metadata.sheetName} 行${metadata.rowIndex}`
          : metadata.fileName;

    const chunkLines: string[] = [];
    chunkLines.push(`> 【来源：${sourceLabel} · 相似度: ${score.toFixed(2)}】`);

    if (metadata.mediaType === "table") {
      for (const line of chunk.text.split(" | ")) {
        chunkLines.push(`> ${line}`);
      }
    } else {
      for (const line of chunk.text.split("\n")) {
        chunkLines.push(`> ${line}`);
      }
    }
    chunkLines.push(``);

    const chunkText = chunkLines.join("\n");

    // 检查是否超出 token 预算
    if (totalChars + chunkText.length > charLimit) {
      log(`Token budget reached: ${totalChars}/${charLimit} chars, skipping remaining chunks`);
      break;
    }

    parts.push(chunkText);
    totalChars += chunkText.length;
  }

  return parts.join("\n");
}
