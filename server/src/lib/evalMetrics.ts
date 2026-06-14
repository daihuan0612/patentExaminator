/**
 * 离线评估指标计算模块（nf5）
 *
 * 实现 golden-set-spec.md §5 定义的全部指标：
 * - 检索质量：NDCG@K（chunk 级）、Recall@K、KB Hit Rate
 * - 生成质量：Faithfulness、Answer Correctness、Fact Coverage（multi-judge）
 * - 确定性指标：Article Accuracy、Source Routing/Attribution Accuracy
 * - 跨源特有：Conflict Resolution、Refusal Accuracy
 *
 * 所有函数为纯计算或 async LLM 调用，不依赖 DB。
 */
import {
  multiJudgeContinuous,
  extractJsonFromLLM,
  type MultiJudgeResult,
} from "./multiJudge.js";
import { logger } from "./logger.js";
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
  retrievedChunks: Array<{ id: string; text?: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 5,
  gradedChunkTexts?: Map<string, string>,
): number {
  if (relevanceGrading.length === 0) return 1;
  const topK = retrievedChunks.slice(0, k);

  // 构建 chunkId → grade 映射
  const gradeMap = new Map<string, number>();
  for (const g of relevanceGrading) {
    gradeMap.set(g.chunkId, g.grade);
  }

  // 为每个检索到的 chunk 分配 relevance
  const relevances: number[] = topK.map((chunk) => {
    // 1. 精确 ID 匹配
    if (gradeMap.has(chunk.id)) return gradeMap.get(chunk.id)!;
    // 2. 内容相似度 fallback：不同 chunk ID 但内容相同
    if (chunk.text && gradedChunkTexts) {
      let bestSim = 0;
      let bestGrade = 0;
      for (const [gid, grade] of gradeMap) {
        const gtext = gradedChunkTexts.get(gid);
        if (gtext) {
          const sim = textSimilarity(chunk.text, gtext);
          if (sim > bestSim) { bestSim = sim; bestGrade = grade; }
        }
      }
      if (bestSim >= TEXT_SIM_THRESHOLD) return bestGrade;
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

  // Cap at 1.0: textSimilarity fallback 可能导致同一 golden chunk 被多个 retrieved chunk 匹配，
  // 使 DCG 略超 IDCG。NDCG 理论上限是 1.0。
  return idcg > 0 ? Math.min(1, dcg / idcg) : 0;
}

/**
 * Recall@K — 检索覆盖率
 *
 * 公式：relevant_in_topK / total_relevant
 * relevant = grade >= gradeThreshold（默认 2）
 */
export function computeRecallChunkLevel(
  retrievedChunks: Array<{ id: string; text?: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 10,
  gradeThreshold: number = 2,
  gradedChunkTexts?: Map<string, string>,
): number {
  if (relevanceGrading.length === 0) return 1;
  const topK = retrievedChunks.slice(0, k);

  const relevantGrades = relevanceGrading.filter((g) => g.grade >= gradeThreshold);
  if (relevantGrades.length === 0) return 1;

  const gradeMap = new Map<string, number>();
  for (const g of relevantGrades) {
    gradeMap.set(g.chunkId, g.grade);
  }

  let found = 0;
  for (const chunk of topK) {
    // 1. 精确 ID 匹配
    if (gradeMap.has(chunk.id)) { found++; continue; }
    // 2. 内容相似度 fallback
    if (chunk.text && gradedChunkTexts) {
      for (const [gid, _grade] of gradeMap) {
        const gtext = gradedChunkTexts.get(gid);
        if (gtext && textSimilarity(chunk.text, gtext) >= TEXT_SIM_THRESHOLD) {
          found++;
          break;
        }
      }
    }
  }

  return found / relevantGrades.length;
}

/**
 * KB Hit Rate — KB 专属题的 Recall@K
 */
export function computeKBHitRate(
  retrievedChunks: Array<{ id: string; text?: string }>,
  relevanceGrading: RelevanceGrade[],
  k: number = 10,
  gradedChunkTexts?: Map<string, string>,
): number {
  const kbGrades = relevanceGrading.filter((g) => g.source === "kb");
  if (kbGrades.length === 0) return 1;
  return computeRecallChunkLevel(retrievedChunks, kbGrades, k, 2, gradedChunkTexts);
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
  judgeApiKeys: Record<string, string>,
  judgeOpts?: { modelFallbacks?: Record<string, string[]>; enableModelFallback?: boolean }
): Promise<MultiJudgeResult<number>> {
  if (!answer || !context) {
    // 空答案无法验证忠实度，返回 0 而非 1
    return { aggregated: 0, individualResults: [], judgeCount: 0 };
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
    { defaultValue: 0.5, ...judgeOpts }
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
  judgeApiKeys: Record<string, string>,
  judgeOpts?: { modelFallbacks?: Record<string, string[]>; enableModelFallback?: boolean }
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
    { defaultValue: 0, ...judgeOpts }
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
  judgeApiKeys: Record<string, string>,
  judgeOpts?: { modelFallbacks?: Record<string, string[]>; enableModelFallback?: boolean }
): Promise<MultiJudgeResult<number>> {
  if (!answer) {
    return { aggregated: 0, individualResults: [], judgeCount: 0 };
  }
  if (mustIncludeFacts.length === 0) {
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
    { defaultValue: 0, ...judgeOpts }
  );
}

// ── 确定性指标（不需要 judge） ──

/**
 * 中文数字 → 阿拉伯数字映射
 */
const CN_NUM_MAP: Record<string, string> = {
  "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
  "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
  "十一": "11", "十二": "12", "十三": "13", "十四": "14", "十五": "15",
  "十六": "16", "十七": "17", "十八": "18", "十九": "19", "二十": "20",
  "二十一": "21", "二十二": "22", "二十三": "23", "二十四": "24", "二十五": "25",
  "二十六": "26", "二十七": "27", "二十八": "28", "二十九": "29",
};

/**
 * 专利法条文 ↔ 审查指南章节 交叉引用表
 *
 * key: 专利法条文（如"第二十二条第二款"）
 * value: 对应的审查指南章节关键词列表
 *
 * 来源：《专利审查指南》与《专利法》对照表
 */
const LAW_TO_GUIDE_KEYWORDS: Record<string, string[]> = {
  // 第二十二条：授予专利权的发明和实用新型应当具备新颖性、创造性和实用性
  "第二十二条": ["新颖性", "创造性", "实用性", "三章", "第四章", "第五章"],
  "第二十二条第一款": ["新颖性", "创造性", "实用性"],
  "第二十二条第二款": ["新颖性", "第三章3.1", "单独对比", "现有技术"],
  "第二十二条第三款": ["创造性", "第四章", "非显而易见", "突出的实质性特点"],
  "第二十三条": ["外观设计", "新颖性", "区别"],
  "第二十四条": ["新颖性宽限", "不丧失新颖性"],
  "第二十五条": ["不授予专利权"],
  "第二十六条": ["说明书", "权利要求书", "充分公开"],
  "第二十六条第三款": ["充分公开", "清楚", "完整", "实现"],
  "第二十六条第四款": ["权利要求", "清楚", "简要", "支持"],
  "第三十三条": ["修改", "超范围"],
  "第三十八条": ["驳回"],
  "第四十一条": ["复审"],
  "第六十四条": ["保护范围", "权利要求"],
};

/**
 * 从法条/章节引用中提取编号（数字部分）
 * 如 "第二十二条第二款" → "22-2", "第6.1节" → "6.1"
 */
function extractArticleNumber(ref: string): string {
  // 匹配 "第N条" 或 "第N条第M款" 格式
  const lawMatch = ref.match(/第([一二三四五六七八九十百]+)条(?:第([一二三四五六七八九十百]+)款)?/);
  if (lawMatch) {
    const article = CN_NUM_MAP[lawMatch[1]!] ?? lawMatch[1]!;
    const clause = lawMatch[2] ? `-${CN_NUM_MAP[lawMatch[2]!] ?? lawMatch[2]}` : "";
    return article + clause;
  }
  // 匹配 "第N.M节" 或 "N.M" 格式（审查指南）
  const guideMatch = ref.match(/(\d+(?:\.\d+)?)/);
  if (guideMatch) return guideMatch[1]!;
  return "";
}

/**
 * 检查法条引用与答案中的引用是否匹配（支持交叉引用）
 *
 * 匹配策略（按优先级）：
 * 1. 直接字符串包含
 * 2. 编号格式统一后匹配（"第九条" ↔ "第9条"）
 * 3. 同一法条的不同款匹配（答案引用法条，expected 是其中一款）
 * 4. 交叉引用：专利法条文 ↔ 审查指南章节（通过共享关键词）
 */
export function computeArticleAccuracy(
  answer: string,
  expectedArticles: string[]
): number {
  if (!answer) return 0;
  if (expectedArticles.length === 0) return 1;

  const normAnswer = answer.toLowerCase();
  // 提取答案中所有法条/章节引用
  const answerRefs = extractAllArticleRefs(answer);
  let matched = 0;

  for (const article of expectedArticles) {
    const normArticle = article.toLowerCase().trim();
    if (!normArticle) continue;

    // 策略 1：直接字符串包含
    if (normAnswer.includes(normArticle)) {
      matched++;
      continue;
    }

    // 策略 2：编号格式统一后匹配（"第二十二条第二款" ↔ "第22条第2款"）
    const normalized = normalizeArticleRef(normArticle);
    if (normalized && normAnswer.includes(normalized)) {
      matched++;
      continue;
    }

    // 策略 3：提取编号比较（"第二十二条第二款" → "22-2"）
    const expectedNum = extractArticleNumber(article);
    if (expectedNum) {
      const answerNums = answerRefs.map(extractArticleNumber).filter(Boolean);
      if (answerNums.some((n) => n === expectedNum || expectedNum.startsWith(n) || n.startsWith(expectedNum))) {
        matched++;
        continue;
      }
    }

    // 策略 4：交叉引用 — 专利法条文 ↔ 审查指南章节
    // 如果 expected 是法条，检查答案是否引用了对应的审查指南章节
    if (checkCrossReference(article, answerRefs, normAnswer)) {
      matched++;
      continue;
    }
  }

  return matched / expectedArticles.length;
}

/**
 * 从文本中提取所有法条/章节引用
 * 匹配：第N条、第N条第M款、第N.M节、第N章、第N节 等
 */
function extractAllArticleRefs(text: string): string[] {
  const refs: string[] = [];
  // 第N条（第M款）
  const lawPattern = /第[一二三四五六七八九十百\d]+条(?:第[一二三四五六七八九十百\d]+款)?/g;
  let match: RegExpExecArray | null;
  while ((match = lawPattern.exec(text)) !== null) {
    refs.push(match[0]);
  }
  // 第N.M节、第N章
  const guidePattern = /第?\d+(?:\.\d+)?(?:节|章|部分)/g;
  while ((match = guidePattern.exec(text)) !== null) {
    refs.push(match[0]);
  }
  // 审查指南特定格式：如 "第二部分第三章3.1节"
  const guideSection = /第[一二三四五六七八九十百]+部分第[一二三四五六七八九十百]+章[\d.]*节?/g;
  while ((match = guideSection.exec(text)) !== null) {
    refs.push(match[0]);
  }
  return refs;
}

/**
 * 将中文法条编号转为阿拉伯数字格式
 * "第二十二条第二款" → "第22条第2款"
 */
function normalizeArticleRef(ref: string): string {
  return ref.replace(/[一二三四五六七八九十百]+/g, (m) => CN_NUM_MAP[m] ?? m);
}

/**
 * 检查交叉引用：expected 法条 vs answer 中的审查指南引用
 *
 * 逻辑：如果 expected 是专利法条文，而 answer 引用了审查指南章节，
 * 通过交叉引用表检查两者是否指向同一法律概念。
 */
function checkCrossReference(
  expectedArticle: string,
  answerRefs: string[],
  normAnswer: string
): boolean {
  // 查找 expected 对应的审查指南关键词
  const expectedNorm = expectedArticle.toLowerCase();
  for (const [law, keywords] of Object.entries(LAW_TO_GUIDE_KEYWORDS)) {
    if (expectedNorm.includes(law.toLowerCase()) || law.toLowerCase().includes(expectedNorm)) {
      // 检查答案中是否有引用审查指南且包含对应关键词
      for (const ref of answerRefs) {
        if (ref.includes("审查指南") || ref.includes("指南") || /\d+\.\d+/.test(ref)) {
          // 答案引用了审查指南，检查是否包含相关关键词
          if (keywords.some((kw) => normAnswer.includes(kw.toLowerCase()))) {
            return true;
          }
        }
      }
      // 也检查答案中是否有同一条法律的其他款（如 expected 是"第二十二条第二款"，
      // 答案只引用了"第二十二条"，也算部分匹配）
      const lawNum = extractArticleNumber(law);
      if (lawNum) {
        for (const ref of answerRefs) {
          const refNum = extractArticleNumber(ref);
          if (refNum && (lawNum.startsWith(refNum) || refNum.startsWith(lawNum))) {
            // 同一条法律，检查关键词
            if (keywords.some((kw) => normAnswer.includes(kw.toLowerCase()))) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
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
 * Refusal Accuracy — no_answer 题中正确拒绝回答的比例（multi-LLM-judge）
 *
 * 规范 §5.3: no_answer 类型题目，系统应回答"无法确定"
 * 使用 multi-judge 而非 pattern matching，避免脆弱的字符串匹配
 */
export async function computeRefusalAccuracy(
  sourceType: SourceType,
  answer: string,
  judgeApiKeys: Record<string, string>,
  judgeOpts?: { modelFallbacks?: Record<string, string[]>; enableModelFallback?: boolean }
): Promise<MultiJudgeResult<number>> {
  if (sourceType !== "no_answer") {
    return { aggregated: 1, individualResults: [], judgeCount: 0 };
  }

  const system = [
    "你是专利复审评估专家。判断一个回答是否正确地拒绝了无法回答的问题。",
    "",
    "背景：这是一个 golden set 中的 no_answer 类型题目，正确做法是表明无法确定/信息不足。",
    "",
    "评分标准（0.0 - 1.0）：",
    "- 1.0: 明确拒绝回答，表明信息不足或无法确定，且保持简洁",
    "- 0.7: 拒绝回答但内容冗长",
    "- 0.4: 部分拒绝但包含不确定的推测",
    "- 0.1: 没有拒绝，直接给出了不确定的答案",
    "- 0.0: 完全没有拒绝，自信地给出了错误答案",
    "",
    "输出 JSON：{ \"score\": 0.0-1.0, \"reasoning\": \"评分理由\" }",
    "严格按 JSON 格式输出，不要输出 markdown 代码块。",
  ].join("\n");

  const user = [
    "## 待评估的回答",
    answer.slice(0, 4000),
    "",
    "请评估该回答是否正确地拒绝了无法回答的问题。",
  ].join("\n");

  return multiJudgeContinuous(
    { system, user },
    judgeApiKeys,
    parseScoreFromJson,
    { defaultValue: 0, ...judgeOpts }
  );
}

// ── 辅助函数 ──

function parseScoreFromJson(rawText: string): number | null {
  const json = extractJsonFromLLM(rawText);
  if (json && typeof json.score === "number") {
    return Math.max(0, Math.min(1, json.score));
  }
  // 诊断日志：解析失败时输出 rawText 前 200 字符
  const preview = rawText.slice(0, 200).replace(/\n/g, "\\n");
  logger.warn(`[parseScoreFromJson] failed: json=${JSON.stringify(json)?.slice(0, 100)}, rawText(200)=${preview}`);
  return null;
}

/**
 * 字符 bigram Jaccard 相似度 — 纯 CPU，不需 LLM
 * 用于 chunk 内容匹配：不同 chunk ID 但内容高度相似时应视为匹配
 */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 取前 500 字符足够区分内容，避免长文本性能问题
  const sa = a.slice(0, 500);
  const sb = b.slice(0, 500);
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s[i]! + s[i + 1]!);
    return set;
  };
  const setA = bigrams(sa);
  const setB = bigrams(sb);
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** 文本相似度阈值：超过此值视为同一内容的不同 chunk */
const TEXT_SIM_THRESHOLD = 0.4;

/** Source name 归一化（去扩展名、折叠空白）— 用于 source attribution 匹配 */
function normalizeDocId(docId: string): string {
  return docId
    .toLowerCase()
    .replace(/\.\w{1,5}$/i, "")       // remove file extension
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

/** Source name fuzzy match — 用于 source attribution 匹配 */
function fuzzyDocMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = new Set(a.split(/\s+/).filter((t) => t.length >= 2));
  const tokensB = b.split(/\s+/).filter((t) => t.length >= 2);
  if (tokensB.length === 0) return false;
  const matched = tokensB.filter((t) => tokensA.has(t)).length;
  return matched / tokensB.length > 0.5;
}
