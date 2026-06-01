/**
 * 服务端重排序器 — 使用多信号评分对检索结果重新排序
 * 从 client/src/lib/knowledge/reranker.ts 迁移到服务端
 *
 * 当没有远程 Re-ranker API 时，使用本地启发式算法。
 * 5 个信号加权：语义相似度、关键词匹配、文档类型、法条引用、chunk 深度
 */

export interface RerankConfig {
  semanticWeight: number;
  keywordWeight: number;
  categoryWeight: number;
  articleRefWeight: number;
  depthWeight: number;
}

const DEFAULT_CONFIG: RerankConfig = {
  semanticWeight: 0.4,
  keywordWeight: 0.25,
  categoryWeight: 0.15,
  articleRefWeight: 0.15,
  depthWeight: 0.05,
};

const CATEGORY_WEIGHTS: Record<string, number> = {
  "法律": 1.0,
  "行政法规": 0.9,
  "司法解释": 0.85,
  "审查指南": 0.95,
  "案例": 0.7,
  "其他": 0.5,
};

interface RerankInput {
  chunkId: string;
  text: string;
  metadata: Record<string, unknown>;
  score: number;
}

interface RerankOutput {
  chunkId: string;
  score: number;
}

/** 对检索结果进行本地重排序 */
export function localRerank(
  results: RerankInput[],
  query: string,
  config: RerankConfig = DEFAULT_CONFIG
): RerankOutput[] {
  if (results.length <= 1) {
    return results.map((r) => ({ chunkId: r.chunkId, score: r.score }));
  }

  const queryTerms = extractTerms(query);

  const scored = results.map((result) => {
    const { chunkId, text, metadata, score: semanticScore } = result;

    // 1. 原始相似度分数
    const s1 = semanticScore;

    // 2. 关键词匹配度
    const chunkTerms = extractTerms(text);
    const matchedTerms = queryTerms.filter((t) => chunkTerms.includes(t));
    const s2 = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;

    // 3. 文档类型权重
    const category = (metadata.documentCategory as string) ?? "其他";
    const s3 = CATEGORY_WEIGHTS[category] ?? 0.5;

    // 4. 法条引用匹配度
    const articleRefs = (metadata.articleRefs as string[]) ?? [];
    const matchedRefs = articleRefs.filter((ref) =>
      queryTerms.some((t) => ref.includes(t) || t.includes(ref))
    );
    const s4 = articleRefs.length > 0 ? matchedRefs.length / articleRefs.length : 0;

    // 5. 深度权重（depth 0 = 最权威）
    const depth = (metadata.depth as number) ?? 2;
    const s5 = 1 - Math.min(depth / 3, 1);

    // 综合评分
    const finalScore =
      s1 * config.semanticWeight +
      s2 * config.keywordWeight +
      s3 * config.categoryWeight +
      s4 * config.articleRefWeight +
      s5 * config.depthWeight;

    return { chunkId, score: finalScore };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/** 提取文本中的关键词（去停用词） */
function extractTerms(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "是", "在", "和", "有", "不", "这", "我", "他", "她", "它",
    "们", "那", "被", "从", "到", "也", "就", "都", "而", "及", "与", "或",
    "但", "如", "所", "之", "等", "将", "已", "可", "对", "于", "其", "上",
    "下", "中", "为", "以", "因", "并", "地", "要", "会", "能", "来", "去",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "through", "during", "before", "after",
  ]);

  const tokens: string[] = [];
  const chineseChars = text.match(/[一-鿿]{2,}/g) ?? [];
  const englishWords = text.match(/[a-zA-Z]{3,}/g) ?? [];
  tokens.push(...chineseChars, ...englishWords.map((w) => w.toLowerCase()));

  return [...new Set(tokens.filter((t) => !stopWords.has(t) && t.length >= 2))];
}
