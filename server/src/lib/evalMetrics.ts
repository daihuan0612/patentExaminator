/**
 * 离线评估指标计算模块（nf5）
 *
 * 实现 golden-set-spec.md §5 定义的全部指标：
 * - 检索质量：NDCG@K（chunk 级）、Recall@K、KB/Web Hit Rate
 * - 生成质量：Faithfulness、Answer Correctness、Fact Coverage（multi-judge）
 * - 确定性指标：Article Accuracy、Source Routing/Attribution Accuracy
 * - 跨源特有：Conflict Resolution、Refusal Accuracy
 *
 * 所有函数为纯计算或 async LLM 调用，不依赖 DB。
 */
import { logger } from "./logger.js";
import {
  multiJudgeContinuous,
  extractJsonFromLLM,
  type MultiJudgeResult,
} from "./multiJudge.js";
import type { RelevanceGrade, SourceType, ExpectedSource } from "../../../shared/src/types/metrics.js";

// ── 检索质量指标（chunk 级，基于 relevance grading） ──

/**
 * NDCG@K — 位置感知的排序质量（chunk 级 graded relevance）
 *
 * 公式：DCG@K / IDCG@K
 * DCG@K = Σᵢ₌₁ᴷ (2^relᵢ - 1) / log₂(i + 1)
 *
 * @param retrievedChunks - 检索到的 chunk 列表（按排序顺序）
 * @param relevanceGrading - golden set 中的 chunk 级 relevance grading
 * @param k - top-K（默认 5）
 */
export function computeNDCGChunkLevel(
  retrievedChunks: Array<{ id: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 5
): number {
  if (relevanceGrading.length === 0) return 1;
  const topK = retrievedChunks.slice(0, k);

  // 构建 chunkId/docId → grade 映射
  const gradeMap = new Map<string, number>();
  for (const g of relevanceGrading) {
    const key = g.chunkId ?? g.docId;
    gradeMap.set(key, g.grade);
    // 也用 docId 做模糊匹配
    if (g.docId) gradeMap.set(normalizeDocId(g.docId), g.grade);
  }

  // 为每个检索到的 chunk 分配 relevance
  const relevances: number[] = topK.map((chunk) => {
    // 精确匹配
    if (gradeMap.has(chunk.id)) return gradeMap.get(chunk.id)!;
    // 模糊匹配
    const normId = normalizeDocId(chunk.id);
    for (const [key, grade] of gradeMap) {
      if (fuzzyDocMatch(normalizeDocId(key), normId)) return grade;
    }
    return 0;
  });

  // DCG
  let dcg = 0;
  for (let i = 0; i < relevances.length; i++) {
    dcg += (Math.pow(2, relevances[i]!) - 1) / Math.log2(i + 2);
  }

  // IDCG：按 grade 降序排列的理想 DCG
  const idealGrades = relevanceGrading
    .map((g) => g.grade)
    .sort((a, b) => b - a)
    .slice(0, k);
  let idcg = 0;
  for (let i = 0; i < idealGrades.length; i++) {
    idcg += (Math.pow(2, idealGrades[i]!) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Recall@K — 检索覆盖率
 *
 * 公式：relevant_in_topK / total_relevant
 * relevant = grade >= gradeThreshold（默认 2）
 */
export function computeRecallChunkLevel(
  retrievedChunks: Array<{ id: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 10,
  gradeThreshold: number = 2
): number {
  if (relevanceGrading.length === 0) return 1;
  const topK = retrievedChunks.slice(0, k);

  const relevantGrades = relevanceGrading.filter((g) => g.grade >= gradeThreshold);
  if (relevantGrades.length === 0) return 1;

  const gradeMap = new Map<string, number>();
  for (const g of relevantGrades) {
    const key = g.chunkId ?? g.docId;
    gradeMap.set(key, g.grade);
    if (g.docId) gradeMap.set(normalizeDocId(g.docId), g.grade);
  }

  let found = 0;
  for (const chunk of topK) {
    if (gradeMap.has(chunk.id)) { found++; continue; }
    const normId = normalizeDocId(chunk.id);
    for (const key of gradeMap.keys()) {
      if (fuzzyDocMatch(normalizeDocId(key), normId)) { found++; break; }
    }
  }

  return found / relevantGrades.length;
}

/**
 * KB Hit Rate — KB 专属题的 Recall@K
 */
export function computeKBHitRate(
  retrievedChunks: Array<{ id: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 10
): number {
  const kbGrades = relevanceGrading.filter((g) => g.source === "kb");
  if (kbGrades.length === 0) return 1;
  return computeRecallChunkLevel(retrievedChunks, kbGrades, k);
}

/**
 * Web Hit Rate — Web 专属题的 Recall@K
 */
export function computeWebHitRate(
  retrievedChunks: Array<{ id: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 10
): number {
  const webGrades = relevanceGrading.filter((g) => g.source === "web");
  if (webGrades.length === 0) return 1;
  return computeRecallChunkLevel(retrievedChunks, webGrades, k);
}

// ── 生成质量指标（multi-judge） ──

/**
 * Faithfulness — 答案是否忠实于检索上下文（reference-free, multi-judge）
 *
 * 规范 §5.2: 3 个 judge 各自拆 claims → 检查支持度 → 取 average
 */
export async function computeFaithfulnessMultiJudge(
  answer: string,
  context: string,
  judgeApiKeys: Record<string, string>
): Promise<MultiJudgeResult<number>> {
  if (!answer || !context) {
    return { aggregated: 1, individualResults: [], judgeCount: 0 };
  }

  const system = [
    "你是专利审查 AI 助手的事实核查员。请判断以下回答是否忠实于提供的参考文档。",
    "",
    "评分标准（0.0 - 1.0）：",
    "- 1.0: 回答完全忠实于文档，所有声明都有文档支撑",
    "- 0.7-0.9: 大部分忠实，个别声明无法验证",
    "- 0.4-0.6: 部分忠实，存在一些无支撑声明",
    "- 0.1-0.3: 大部分不忠实，多数声明无文档支撑",
    "- 0.0: 完全不忠实，回答与文档无关或全是幻觉",
    "",
    "输出 JSON：{ \"score\": 0.0-1.0, \"reasoning\": \"评分理由\" }",
    "严格按 JSON 格式输出，不要输出 markdown 代码块。",
  ].join("\n");

  const user = [
    "## 参考文档",
    context.slice(0, 8000),
    "",
    "## AI 生成的回答",
    answer.slice(0, 4000),
    "",
    "请评估回答的忠实度。",
  ].join("\n");

  return multiJudgeContinuous(
    { system, user },
    judgeApiKeys,
    parseScoreFromJson,
    { defaultValue: 0.5 }
  );
}

/**
 * Answer Correctness — 答案与参考答案的匹配度（multi-judge）
 *
 * 规范 §5.2: 3 个 judge 各自对比 expectedAnswer → 取 average
 */
export async function computeAnswerCorrectness(
  answer: string,
  expectedAnswer: string,
  judgeApiKeys: Record<string, string>
): Promise<MultiJudgeResult<number>> {
  if (!answer || !expectedAnswer) {
    return { aggregated: 0, individualResults: [], judgeCount: 0 };
  }

  const system = [
    "你是专利复审评估专家。给定一个参考答案和一个实际答案，请判断实际答案的正确性。",
    "",
    "评分标准（0.0 - 1.0）：",
    "- 1.0: 完全正确，覆盖参考答案所有要点",
    "- 0.7-0.9: 大部分正确，遗漏个别要点",
    "- 0.4-0.6: 部分正确，有明显遗漏或错误",
    "- 0.1-0.3: 大部分错误",
    "- 0.0: 完全错误或无关",
    "",
    "输出 JSON：{ \"score\": 0.0-1.0, \"reasoning\": \"评分理由\" }",
    "严格按 JSON 格式输出，不要输出 markdown 代码块。",
  ].join("\n");

  const user = [
    "## 参考答案",
    expectedAnswer,
    "",
    "## 实际答案",
    answer.slice(0, 4000),
    "",
    "请评估实际答案的正确性。",
  ].join("\n");

  return multiJudgeContinuous(
    { system, user },
    judgeApiKeys,
    parseScoreFromJson,
    { defaultValue: 0 }
  );
}

/**
 * Fact Coverage — 必须包含的关键事实点是否被覆盖（multi-judge）
 *
 * 规范 §5.2: 3 个 judge 各自检查事实点覆盖 → 取 average
 */
export async function computeFactCoverage(
  answer: string,
  mustIncludeFacts: string[],
  judgeApiKeys: Record<string, string>
): Promise<MultiJudgeResult<number>> {
  if (!answer || mustIncludeFacts.length === 0) {
    return { aggregated: 1, individualResults: [], judgeCount: 0 };
  }

  const factsList = mustIncludeFacts.map((f, i) => `${i + 1}. ${f}`).join("\n");

  const system = [
    "你是专利复审评估专家。给定一个答案和一组必须包含的关键事实点，请检查答案是否覆盖了每个事实点。",
    "",
    "对每个事实点判断：答案是否包含了该事实（语义匹配，不要求原文完全一致）。",
    "",
    "输出 JSON：",
    "{",
    '  "coverage": [',
    '    { "fact": "事实点原文", "covered": true/false, "evidence": "答案中的相关文本（如有）" }',
    "  ],",
    '  "score": 0.0-1.0',
    "}",
    "score = 被覆盖的事实点数 / 总事实点数",
    "严格按 JSON 格式输出，不要输出 markdown 代码块。",
  ].join("\n");

  const user = [
    "## 必须包含的关键事实点",
    factsList,
    "",
    "## 答案",
    answer.slice(0, 4000),
    "",
    "请检查答案是否覆盖了每个事实点。",
  ].join("\n");

  return multiJudgeContinuous(
    { system, user },
    judgeApiKeys,
    (rawText) => {
      // 优先从 JSON 中提取 score 字段
      const json = extractJsonFromLLM(rawText);
      if (json && typeof json.score === "number") return json.score;
      // fallback: 从 coverage 数组计算
      if (json && Array.isArray(json.coverage)) {
        const covered = json.coverage.filter((c: { covered?: boolean }) => c.covered).length;
        return json.coverage.length > 0 ? covered / json.coverage.length : 0;
      }
      return null;
    },
    { defaultValue: 0 }
  );
}

// ── 确定性指标（不需要 judge） ──

/**
 * Article Accuracy — 答案引用的法条与期望法条的匹配度
 *
 * 公式：expectedArticles 中被答案引用的比例
 * 确定性计算，不需要 LLM judge
 */
export function computeArticleAccuracy(
  answer: string,
  expectedArticles: string[]
): number {
  if (!answer || expectedArticles.length === 0) return 1;

  const normAnswer = answer.toLowerCase();
  let matched = 0;

  for (const article of expectedArticles) {
    const normArticle = article.toLowerCase().trim();
    if (!normArticle) continue;
    // 模糊匹配：答案中包含法条引用
    if (normAnswer.includes(normArticle)) {
      matched++;
      continue;
    }
    // 尝试提取法条编号匹配（如"第九条" ↔ "第9条"）
    const normalized = normArticle.replace(/[一二三四五六七八九十百]+/g, (m) => {
      const map: Record<string, string> = {
        "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
        "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
        "百": "100",
      };
      return map[m] ?? m;
    });
    if (normAnswer.includes(normalized)) matched++;
  }

  return matched / expectedArticles.length;
}

/**
 * Source Routing Accuracy — 路由是否正确
 *
 * 比较 expectedSource vs 实际使用的源
 */
export function computeSourceRoutingAccuracy(
  expectedSource: ExpectedSource,
  actualSources: { kb: boolean; web: boolean }
): number {
  switch (expectedSource) {
    case "kb":
      return actualSources.kb ? 1 : 0;
    case "web":
      return actualSources.web ? 1 : 0;
    case "kb+web":
      return (actualSources.kb && actualSources.web) ? 1 :
        (actualSources.kb || actualSources.web) ? 0.5 : 0;
    case "any":
      return 1; // 任何源都算正确
    default:
      return 0;
  }
}

/**
 * Source Attribution Accuracy — 引用的来源是否真实被使用
 *
 * 检查答案中引用的来源是否实际被检索/使用
 */
export function computeSourceAttributionAccuracy(
  citedSources: string[],
  actualUsedSources: string[]
): number {
  if (citedSources.length === 0) return 1;

  const normUsed = actualUsedSources.map(normalizeDocId);
  let matched = 0;

  for (const cited of citedSources) {
    const normCited = normalizeDocId(cited);
    if (normUsed.some((used) => fuzzyDocMatch(used, normCited))) {
      matched++;
    }
  }

  return matched / citedSources.length;
}

/**
 * Conflict Resolution Rate — 冲突题中正确选择权威源的比例
 *
 * 规范 §5.3: conflict 类型题目，正确行为是优先采用 KB（权威来源）
 */
export function computeConflictResolution(
  sourceType: SourceType,
  expectedSource: ExpectedSource,
  actualSource: "kb" | "web" | "mixed"
): number {
  if (sourceType !== "conflict") return 1; // 非冲突题不评估

  // conflict 题的 expectedSource 应为 "kb"（权威优先）
  if (expectedSource === "kb") {
    return actualSource === "kb" ? 1 : 0;
  }
  return actualSource === "kb" ? 1 : 0.5;
}

/**
 * Refusal Accuracy — no_answer 题中正确拒绝回答的比例
 *
 * 规范 §5.3: no_answer 类型题目，系统应回答"无法确定"
 */
export function computeRefusalAccuracy(
  sourceType: SourceType,
  answer: string
): number {
  if (sourceType !== "no_answer") return 1; // 非拒绝题不评估

  const refusalPatterns = [
    "无法确定", "无法判断", "需要进一步查证", "不确定",
    "没有可靠", "没有找到", "未找到", "无法回答",
    "cannot determine", "unable to", "not found", "no reliable",
    "信息不足", "证据不足", "暂无",
  ];

  const normAnswer = answer.toLowerCase();
  const hasRefusal = refusalPatterns.some((p) => normAnswer.includes(p));

  // 同时检查答案是否过长（拒绝回答应该简短）
  const isConcise = answer.length < 500;

  return hasRefusal && isConcise ? 1 : hasRefusal ? 0.7 : 0;
}

// ── 辅助函数 ──

function parseScoreFromJson(rawText: string): number | null {
  const json = extractJsonFromLLM(rawText);
  if (json && typeof json.score === "number") {
    return Math.max(0, Math.min(1, json.score));
  }
  return null;
}

function normalizeDocId(docId: string): string {
  return docId
    .toLowerCase()
    .replace(/\.\w{1,5}$/i, "")       // remove file extension
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

function fuzzyDocMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Token overlap: split by space only (keep hyphens as part of tokens)
  const tokensA = new Set(a.split(/\s+/).filter((t) => t.length >= 2));
  const tokensB = b.split(/\s+/).filter((t) => t.length >= 2);
  if (tokensB.length === 0) return false;
  const matched = tokensB.filter((t) => tokensA.has(t)).length;
  return matched / tokensB.length > 0.5;
}
