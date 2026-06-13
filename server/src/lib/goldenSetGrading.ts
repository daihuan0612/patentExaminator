/**
 * Golden Set A.2 — Relevance Grading
 *
 * spec §5.2: 为每道题建立 chunk 级 ground truth 池。
 *
 * 为什么必须独立采样？
 * A.1 生成题目时使用的 chunk 是 LLM 生成问题的上下文，天然高度相关。
 * 用它做 grading 是循环自证——所有生成 chunk 都会得 grade 3，对评估检索排序没有价值。
 *
 * A.2 必须从知识库独立采样一批候选（与生成 chunk 无关），
 * 包含相关和不相关的 chunk，才能真实反映 RAG 检索的排序质量。
 *
 * 候选集构建规则：
 * - 正样本：A.1 持久化的 context_chunk_ids（生成该题时实际使用的 KB chunks）
 * - 负样本：从知识库随机采样 1 个其他 chunk（排除正样本）
 *
 * Multi-Judge 配置：2 个 judge（MiMo + DeepSeek），取算术平均。
 */
import { getSyncDb } from "./syncDb.js";
import { logger } from "./logger.js";
import { getAllChunks, getAllSources, getChunksByIds } from "./knowledgeDb.js";
import { callMultiJudge, aggregateDiscrete, DEFAULT_JUDGE_CONFIGS } from "./multiJudge.js";
import type { RelevanceGrade, JudgeResult } from "@shared/types/metrics";

// ── Grading Prompt ────────────────────────────────────

const GRADING_SYSTEM_PROMPT = `你是专利复审领域的评估专家。给定一个问题和多个文本，请判断每个文本对回答问题的相关程度。

评分标准：
- 0分：完全不相关，文本内容与问题主题毫无关联
- 1分：边际相关，文本与问题属于同一法律/技术领域（如同为专利法条文），或提到了相关背景概念
- 2分：相关，文本包含与问题主题直接相关的内容（如问题提到的法律条文、技术方案、审查标准等）
- 3分：高度相关，文本包含能够直接支撑回答问题的关键信息

重要提示：
1. 专利法是一个整体体系，不同条款之间存在关联。如果文本和问题都涉及专利法（即使具体条款不同），应至少给 1 分
2. 只要文本包含了问题中提到的法律条款原文、相关技术概念或审查标准，就应得到 2 分或 3 分
3. 文本不需要"直接回答"问题才算相关——只要包含问题涉及的关键术语和概念就应该得到较高分数
4. 如果文本包含问题中明确提到的法律条款（如"专利法第X条"），应得到至少 2 分

请输出 JSON 数组，每个元素对应一个文本的评分：
[
  {"id": "A", "grade": 0|1|2|3, "rationale": "打分理由"},
  {"id": "B", "grade": 0|1|2|3, "rationale": "打分理由"},
  ...
]`;

function buildBatchGradingUserPrompt(
  query: string,
  candidates: Array<{ label: string; text: string }>,
): string {
  const parts = candidates.map(c =>
    `文本 ${c.label}：\n${c.text}`
  ).join("\n\n---\n\n");
  return `问题：${query}\n\n请对以下 ${candidates.length} 个文本分别评分：\n\n${parts}`;
}

// ── DB Helpers ────────────────────────────────────────

interface GoldenQuestionRow {
  id: string;
  query: string;
  source_type: string;
  expected_sources: string;
  relevance_grading: string;
  context_chunk_ids: string;
}

function loadAllQuestions(): GoldenQuestionRow[] {
  const db = getSyncDb();
  return db.prepare(
    `SELECT id, query, source_type, expected_sources, relevance_grading, context_chunk_ids
     FROM metrics_golden_set ORDER BY created_at`
  ).all() as GoldenQuestionRow[];
}

function updateRelevanceGrading(questionId: string, grading: RelevanceGrade[]): void {
  const db = getSyncDb();
  db.prepare(
    `UPDATE metrics_golden_set SET relevance_grading = ? WHERE id = ?`
  ).run(JSON.stringify(grading), questionId);
}

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

// ── Independent Sampling ──────────────────────────────

/**
 * 从知识库独立采样一个 chunk（与生成 chunk 无关）。
 * 支持排除指定 chunk ID（避免采样到正样本）。
 * 返回 null 如果知识库为空。
 */
function sampleRandomChunk(excludeIds?: Set<string>): { id: string; text: string; sourceName: string } | null {
  const allChunks = getAllChunks();
  if (allChunks.length === 0) return null;

  const sources = getAllSources();
  const sourceMap = new Map(sources.map(s => [s.id, s.name]));

  // 过滤掉需要排除的 chunks
  const candidates = excludeIds
    ? allChunks.filter(c => !excludeIds.has(c.id))
    : allChunks;
  if (candidates.length === 0) return null;

  const idx = Math.floor(Math.random() * candidates.length);
  const chunk = candidates[idx]!;
  return {
    id: chunk.id,
    text: chunk.text,
    sourceName: sourceMap.get(chunk.sourceId) ?? "unknown",
  };
}

// ── Batch Grading ─────────────────────────────────────

/**
 * 解析批量 grading 的 judge 输出（JSON 数组）。
 * 返回 label → grade 的映射。
 */
function parseBatchJudgeOutput(
  output: { providerId: string; success: boolean; rawText: string; error?: string },
  labels: string[],
): Map<string, { grade: number | null; rationale: string }> {
  const result = new Map<string, { grade: number | null; rationale: string }>();
  if (!output.success) {
    for (const label of labels) {
      result.set(label, { grade: null, rationale: `judge_failed: ${output.error}` });
    }
    return result;
  }
  try {
    const jsonMatch = output.rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in response");
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: string; grade: number; rationale: string }>;
    for (const item of parsed) {
      const grade = Math.max(0, Math.min(3, Math.round(item.grade))) as 0 | 1 | 2 | 3;
      result.set(item.id, { grade, rationale: item.rationale });
    }
    // 补充缺失的 label
    for (const label of labels) {
      if (!result.has(label)) {
        result.set(label, { grade: null, rationale: "missing from judge output" });
      }
    }
  } catch (e) {
    logger.warn(`[A.2 Grading] Failed to parse batch judge output: ${e}`);
    for (const label of labels) {
      result.set(label, { grade: null, rationale: `parse_failed: ${e}` });
    }
  }
  return result;
}

/**
 * 对单道题的候选集进行批量 grading。
 *
 * 批量模式：同一题的所有候选合并为 1 个 prompt，每个 judge 只需 1 次调用。
 * 2 个 judge（MiMo + volcengine）并行打分，每个候选取 2 judge 的算术平均。
 *
 * 并行度：2（judges），不是 candidates × 2
 * 请求数：每题 2 次（原来是 candidates × 2 次）
 */
async function gradeQuestion(
  query: string,
  candidates: Array<{ docId: string; chunkId?: string; text: string; source: "kb" | "web" }>,
  judgeApiKeys: Record<string, string>,
): Promise<RelevanceGrade[]> {
  if (candidates.length === 0) return [];

  // 为每个候选分配 label（A, B, C, D）
  const labels = candidates.map((_, i) => String.fromCharCode(65 + i)); // A, B, C, D
  const labeledCandidates = candidates.map((c, i) => ({ label: labels[i]!, text: c.text }));

  const userPrompt = buildBatchGradingUserPrompt(query, labeledCandidates);

  // 2 个 judge 并行，每个 judge 一次请求评所有候选
  const judgeOutputs = await callMultiJudge(
    { system: GRADING_SYSTEM_PROMPT, user: userPrompt },
    judgeApiKeys,
    { judgeConfigs: DEFAULT_JUDGE_CONFIGS, temperature: 0, maxTokens: 1000 },
  );

  // 解析每个 judge 的批量输出
  const judgeResultsPerCandidate = new Map<string, JudgeResult[]>();
  const gradesPerCandidate = new Map<string, number[]>();
  for (const label of labels) {
    judgeResultsPerCandidate.set(label, []);
    gradesPerCandidate.set(label, []);
  }

  for (const output of judgeOutputs) {
    const batchResult = parseBatchJudgeOutput(output, labels);
    for (const [label, { grade, rationale }] of batchResult) {
      judgeResultsPerCandidate.get(label)!.push({
        provider: output.providerId,
        grade: grade as (0 | 1 | 2 | 3 | null),
        rationale,
      });
      if (grade !== null) {
        gradesPerCandidate.get(label)!.push(grade);
      }
    }
  }

  // 为每个候选聚合 grade
  return candidates.map((candidate, i) => {
    const label = labels[i]!;
    const judgeResults = judgeResultsPerCandidate.get(label)!;
    const numericGrades = gradesPerCandidate.get(label)!;
    const aggregatedGrade = numericGrades.length >= 1
      ? aggregateDiscrete(numericGrades) as 0 | 1 | 2 | 3
      : 0;

    return {
      source: candidate.source,
      docId: candidate.docId,
      chunkId: candidate.chunkId ?? "",
      grade: aggregatedGrade,
      rationale: judgeResults.map(j => `${j.provider}:${j.grade ?? "fail"}(${j.rationale})`).join("; "),
      judges: judgeResults,
    };
  });
}

// ── Public API ────────────────────────────────────────

/**
 * 对 golden set 中所有题目执行 A.2 Relevance Grading。
 *
 * 流程（spec §5.2）：
 * 1. 加载 A.1 生成的所有题目
 * 2. 对每道题，构建候选集（每题 2 个）：
 *    - 候选 1：生成该题用的 chunk（正样本，从 expectedSources 推断）
 *    - 候选 2：从知识库随机采样 1 个其他 chunk（负样本）
 * 3. 2 个 LLM judge（MiMo + DeepSeek）对每个候选独立打分（0-3）
 * 4. 聚合：2 个 judge 取平均
 * 5. 写回 DB（更新 relevance_grading 字段）
 *
 * @param judgeApiKeys - 每个 judge provider 的 API key
 * @returns 每道题的 grading 结果
 */
export async function gradeGoldenSet(
  judgeApiKeys: Record<string, string>,
): Promise<Array<{ questionId: string; grading: RelevanceGrade[] }>> {
  const allQuestions = loadAllQuestions();
  // 有 contextChunkIds 的题目都需要 grading（kb_only + cross_source + conflict + no_answer）
  // web_only 没有 KB chunk，跳过
  const questions = allQuestions.filter(q => {
    const chunkIds: string[] = safeParseJson(q.context_chunk_ids, []);
    return chunkIds.length > 0;
  });
  logger.info(`[A.2 Grading] Starting grading for ${questions.length} questions with KB chunks (skipped ${allQuestions.length - questions.length} without KB chunks)`);

  const results: Array<{ questionId: string; grading: RelevanceGrade[] }> = [];

  for (const q of questions) {
    // 构建候选集
    const candidates: Array<{ docId: string; chunkId?: string; text: string; source: "kb" | "web" }> = [];
    const contextChunkIds: string[] = safeParseJson(q.context_chunk_ids, []);
    const contextIdSet = new Set(contextChunkIds);

    const sources = getAllSources();
    const sourceMap = new Map(sources.map(s => [s.id, s.name]));

    // 候选（正样本）：使用 A.1 生成时实际使用的 KB chunks
    if (contextChunkIds.length > 0) {
      const contextChunks = getChunksByIds(contextChunkIds);
      for (const chunk of contextChunks) {
        candidates.push({
          docId: sourceMap.get(chunk.sourceId) ?? "unknown",
          chunkId: chunk.id,
          text: chunk.text,
          source: "kb",
        });
      }
    }

    // 候选（负样本）：从知识库随机采样 3 个 chunk（排除正样本）
    // 确保有足够的负样本，即使 KB 很小也能得到对比信号
    const usedIds = new Set(contextIdSet);
    for (let i = 0; i < 3; i++) {
      const negativeSample = sampleRandomChunk(usedIds);
      if (negativeSample) {
        candidates.push({
          docId: negativeSample.sourceName,
          chunkId: negativeSample.id,
          text: negativeSample.text,
          source: "kb",
        });
        usedIds.add(negativeSample.id);
      }
    }

    if (candidates.length === 0) {
      logger.warn(`[A.2 Grading] Q=${q.id}: No candidates available, skipping`);
      results.push({ questionId: q.id, grading: [] });
      continue;
    }

    try {
      const grading = await gradeQuestion(q.query, candidates, judgeApiKeys);
      updateRelevanceGrading(q.id, grading);
      results.push({ questionId: q.id, grading });
      // Debug: 输出每个候选的 grade 分布
      const gradeSummary = grading.map(g => `${g.source}:${g.grade}`).join(", ");
      logger.info(`[A.2 Grading] Q=${q.id}: ${grading.length} candidates [${gradeSummary}]`);
    } catch (err) {
      logger.warn(`[A.2 Grading] Q=${q.id} failed: ${err}`);
      results.push({ questionId: q.id, grading: [] });
    }
  }

  logger.info(`[A.2 Grading] Complete: ${results.length} questions graded`);
  return results;
}
