/**
 * Golden Set B — 质量评估
 *
 * spec §5.3: 验证 A.1 + A.2 产出的 golden set 本身质量是否达标。
 *
 * 为什么需要这个阶段？
 * Golden set 是所有指标的 ground truth 来源。如果 golden set 质量差
 * （题目不合理、答案错误、grading 不可信），后续 C 阶段产出的所有指标都不可信——垃圾进，垃圾出。
 *
 * B 阶段是 golden set 的"出厂质检"，确保只有合格的 golden set 才进入 C 阶段。
 *
 * 所有检查都是确定性规则，不调用 LLM。
 */
import path from "path";
import { getSyncDb } from "./syncDb.js";
import { logger } from "./logger.js";
import type { RelevanceGrade } from "@shared/types/metrics";

const DATA_DIR = process.env.SYNC_DB_DIR ?? path.resolve(process.cwd(), "data");
const GOLDEN_SET_DB_PATH = process.env.SYNC_DB_PATH ?? path.join(DATA_DIR, "patent-examiner.db");

// ── Types ─────────────────────────────────────────────

export interface CheckResult {
  passed: boolean;
  detail: string;
  questions?: string[];  // 有问题的题目 ID
}

export interface QualityReport {
  passed: boolean;
  totalQuestions: number;
  goldenSetPath: string;  // golden set JSON 文件的完整路径
  checks: {
    B1_count: CheckResult;
    B2_matrix: CheckResult;
    B3_query_quality: CheckResult;
    B4_answer_quality: CheckResult;
    B5_facts_quality: CheckResult;
    B6_grading_nonempty: CheckResult;
    B7_grading_distribution: CheckResult;
    B8_min_grade: CheckResult;
    B9_judge_consistency: CheckResult;
    B10_no_duplicates: CheckResult;
  };
  warnings: string[];
  recommendation: string;
}

// ── DB Helpers ────────────────────────────────────────

interface GoldenQuestionRow {
  id: string;
  query: string;
  expected_answer: string;
  expected_articles: string;
  category: string;
  source_type: string;
  must_include_facts: string;
  relevance_grading: string;
  context_chunk_ids: string;
}

function loadAllQuestions(): GoldenQuestionRow[] {
  const db = getSyncDb();
  return db.prepare(
    `SELECT id, query, expected_answer, expected_articles, category,
            source_type, must_include_facts, relevance_grading, context_chunk_ids
     FROM metrics_golden_set ORDER BY created_at`
  ).all() as GoldenQuestionRow[];
}

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

// ── Expected Matrix (spec §4.4) ───────────────────────

/** 21 个非零 cell 的 sourceType × category 组合 */
const EXPECTED_MATRIX: Array<{ sourceType: string; category: string }> = [
  // R1: kb_only × 5 categories
  { sourceType: "kb_only", category: "新颖性" },
  { sourceType: "kb_only", category: "创造性" },
  { sourceType: "kb_only", category: "权利要求" },
  { sourceType: "kb_only", category: "形式缺陷" },
  { sourceType: "kb_only", category: "程序" },
  // R2: web_only × 5 categories
  { sourceType: "web_only", category: "新颖性" },
  { sourceType: "web_only", category: "创造性" },
  { sourceType: "web_only", category: "权利要求" },
  { sourceType: "web_only", category: "形式缺陷" },
  { sourceType: "web_only", category: "程序" },
  // R3: cross_source × 5 categories
  { sourceType: "cross_source", category: "新颖性" },
  { sourceType: "cross_source", category: "创造性" },
  { sourceType: "cross_source", category: "权利要求" },
  { sourceType: "cross_source", category: "形式缺陷" },
  { sourceType: "cross_source", category: "程序" },
  // R4: conflict × 3 categories
  { sourceType: "conflict", category: "新颖性" },
  { sourceType: "conflict", category: "创造性" },
  { sourceType: "conflict", category: "权利要求" },
  // R5: no_answer × 3 categories
  { sourceType: "no_answer", category: "创造性" },
  { sourceType: "no_answer", category: "创造性" },
  { sourceType: "no_answer", category: "程序" },
];

// ── Quality Checks ────────────────────────────────────

function checkB1Count(questions: GoldenQuestionRow[]): CheckResult {
  const passed = questions.length === 21;
  return { passed, detail: `${questions.length}/21` };
}

function checkB2Matrix(questions: GoldenQuestionRow[]): CheckResult {
  const covered = new Set<string>();
  for (const q of questions) {
    covered.add(`${q.source_type}|${q.category}`);
  }

  const missing: string[] = [];
  for (const cell of EXPECTED_MATRIX) {
    const key = `${cell.sourceType}|${cell.category}`;
    if (!covered.has(key)) missing.push(key);
  }

  const passed = missing.length === 0;
  return {
    passed,
    detail: passed
      ? `${EXPECTED_MATRIX.length}/${EXPECTED_MATRIX.length} cells covered`
      : `${EXPECTED_MATRIX.length - missing.length}/${EXPECTED_MATRIX.length} cells covered, missing: ${missing.join(", ")}`,
  };
}

function checkB3QueryQuality(questions: GoldenQuestionRow[]): CheckResult {
  const issues: string[] = [];
  for (const q of questions) {
    if (q.query.length < 20) {
      issues.push(`${q.id}: query too short (${q.query.length} chars)`);
    }
  }
  return {
    passed: issues.length === 0,
    detail: issues.length === 0 ? "0 issues" : `${issues.length} queries too short`,
    questions: issues.map(i => i.split(":")[0]!),
  };
}

function checkB4AnswerQuality(questions: GoldenQuestionRow[]): CheckResult {
  const issues: string[] = [];
  for (const q of questions) {
    const len = q.expected_answer.length;
    if (len < 200) {
      issues.push(`${q.id}: answer too short (${len} chars, min 200)`);
    } else if (len > 500) {
      issues.push(`${q.id}: answer too long (${len} chars, max 500)`);
    }
  }
  return {
    passed: issues.length === 0,
    detail: issues.length === 0 ? "0 issues" : `${issues.length} answers out of range`,
    questions: issues.map(i => i.split(":")[0]!),
  };
}

function checkB5FactsQuality(questions: GoldenQuestionRow[]): CheckResult {
  const issues: string[] = [];
  for (const q of questions) {
    const facts = safeParseJson<string[]>(q.must_include_facts, []);
    if (facts.length < 3) {
      issues.push(`${q.id}: only ${facts.length} facts (min 3)`);
    } else if (facts.length > 8) {
      issues.push(`${q.id}: too many facts (${facts.length}, max 8)`);
    }
  }
  return {
    passed: issues.length === 0,
    detail: issues.length === 0 ? "0 issues" : `${issues.length} questions with bad fact count`,
    questions: issues.map(i => i.split(":")[0]!),
  };
}

function checkB6GradingNonempty(questions: GoldenQuestionRow[]): CheckResult {
  // 检查所有有 contextChunkIds 的题目（kb_only + cross_source + conflict + no_answer）
  const gradedQuestions = questions.filter(q => {
    const chunkIds = safeParseJson<string[]>(q.context_chunk_ids, []);
    return chunkIds.length > 0;
  });
  const missing: string[] = [];
  for (const q of gradedQuestions) {
    const grading = safeParseJson<RelevanceGrade[]>(q.relevance_grading, []);
    if (grading.length === 0) missing.push(q.id);
  }
  return {
    passed: missing.length === 0,
    detail: missing.length === 0
      ? `${gradedQuestions.length}/${gradedQuestions.length} questions with KB chunks have grading`
      : `${gradedQuestions.length - missing.length}/${gradedQuestions.length} questions with KB chunks have grading`,
    questions: missing,
  };
}

function checkB7GradingDistribution(questions: GoldenQuestionRow[]): CheckResult {
  // 检查有 grading 数据的题目的正样本（排除 no_answer：它的正样本 grade=0 是预期行为）
  // 正样本（contextChunkIds 中的 chunk）不能全是 grade=0
  // 允许 ≤20% 失败（KB 小时随机 chunk 可能不相关）
  const failed: string[] = [];
  for (const q of questions) {
    if (q.source_type === "no_answer") continue;
    const grading = safeParseJson<RelevanceGrade[]>(q.relevance_grading, []);
    if (grading.length === 0) continue;
    const chunkIds = safeParseJson<string[]>(q.context_chunk_ids, []);
    const positiveGrades = grading.filter(g => g.source === "kb" && chunkIds.includes(g.chunkId ?? ""));
    if (positiveGrades.length === 0) continue;
    const allZero = positiveGrades.every(g => g.grade === 0);
    if (allZero) failed.push(q.id);
  }
  const threshold = Math.ceil(questions.filter(q => q.source_type !== "no_answer").length * 0.2);
  return {
    passed: failed.length <= threshold,
    detail: failed.length === 0
      ? `All graded questions have at least one relevant positive sample`
      : `${failed.length} questions with all positive samples graded 0 (threshold: ${threshold})`,
    questions: failed,
  };
}

function checkB8MinGrade(questions: GoldenQuestionRow[]): CheckResult {
  // 检查有 grading 数据的题目的正样本至少有一个 grade≥1（排除 no_answer）
  const failing: string[] = [];
  for (const q of questions) {
    if (q.source_type === "no_answer") continue;
    const grading = safeParseJson<RelevanceGrade[]>(q.relevance_grading, []);
    if (grading.length === 0) continue;
    const chunkIds = safeParseJson<string[]>(q.context_chunk_ids, []);
    const positiveGrades = grading.filter(g => g.source === "kb" && chunkIds.includes(g.chunkId ?? ""));
    if (positiveGrades.length === 0) continue;
    const hasRelevant = positiveGrades.some(g => g.grade >= 1);
    if (!hasRelevant) failing.push(q.id);
  }
  const eligibleCount = questions.filter(q => q.source_type !== "no_answer").length;
  const threshold = Math.ceil(eligibleCount * 0.2);
  const passing = eligibleCount - failing.length;
  return {
    passed: failing.length <= threshold,
    detail: failing.length === 0
      ? `All graded questions have at least one grade≥1 positive sample`
      : `${passing}/${eligibleCount} graded questions have positive grade≥1 (threshold: ${threshold} failures)`,
    questions: failing,
  };
}

function checkB9JudgeConsistency(questions: GoldenQuestionRow[]): CheckResult {
  // 检查所有有 grading 数据的题目
  const inconsistent: string[] = [];
  for (const q of questions) {
    const grading = safeParseJson<RelevanceGrade[]>(q.relevance_grading, []);
    for (const g of grading) {
      if (!g.judges || g.judges.length < 2) continue;
      const grades = g.judges
        .filter(j => j.grade !== null)
        .map(j => j.grade as number);
      if (grades.length < 2) continue;
      const maxDiff = Math.max(...grades) - Math.min(...grades);
      if (maxDiff > 2) {
        inconsistent.push(q.id);
        break;  // 只需标记一次
      }
    }
  }
  return {
    passed: inconsistent.length === 0,
    detail: inconsistent.length === 0
      ? "0 kb_only questions with judge variance > 2"
      : `${inconsistent.length} kb_only questions with high judge variance`,
    questions: inconsistent,
  };
}

function checkB10NoDuplicates(questions: GoldenQuestionRow[]): CheckResult {
  const seen = new Map<string, string>();  // normalized query → first id
  const duplicates: string[] = [];

  for (const q of questions) {
    const normalized = q.query.toLowerCase().replace(/\s+/g, "").slice(0, 50);
    const existing = seen.get(normalized);
    if (existing) {
      duplicates.push(q.id);
    } else {
      seen.set(normalized, q.id);
    }
  }

  return {
    passed: duplicates.length === 0,
    detail: duplicates.length === 0
      ? "0 duplicates"
      : `${duplicates.length} duplicate queries`,
    questions: duplicates,
  };
}

// ── Decision Rules ────────────────────────────────────

function buildRecommendation(
  checks: QualityReport["checks"],
  _warnings: string[],
): string {
  // B1/B2 不通过 → 重跑 A.1
  if (!checks.B1_count.passed || !checks.B2_matrix.passed) {
    return "REGENERATE_A1 — 题目数量或矩阵覆盖不合格";
  }
  // B6 不通过 → 重跑 A.2
  if (!checks.B6_grading_nonempty.passed) {
    return "REGENERATE_A2 — relevance grading 缺失";
  }
  // 其他检查不通过 → 标记不可信
  const failedChecks = Object.entries(checks).filter(([_, v]) => !v.passed);
  if (failedChecks.length > 0) {
    return `PROCEED_WITH_CAUTION — ${failedChecks.length} checks failed, review flagged questions`;
  }
  return "PROCEED — all checks passed";
}

// ── Public API ────────────────────────────────────────

/**
 * 对 golden set 执行 B 阶段质量评估。
 *
 * spec §5.3: 10 项确定性检查，不调用 LLM。
 *
 * @returns 质量报告（通过 / 不通过 + 具体问题清单）
 */
export function evaluateGoldenSetQuality(): QualityReport {
  const questions = loadAllQuestions();
  logger.info(`[B Quality] Starting quality evaluation for ${questions.length} questions`);

  const checks = {
    B1_count: checkB1Count(questions),
    B2_matrix: checkB2Matrix(questions),
    B3_query_quality: checkB3QueryQuality(questions),
    B4_answer_quality: checkB4AnswerQuality(questions),
    B5_facts_quality: checkB5FactsQuality(questions),
    B6_grading_nonempty: checkB6GradingNonempty(questions),
    B7_grading_distribution: checkB7GradingDistribution(questions),
    B8_min_grade: checkB8MinGrade(questions),
    B9_judge_consistency: checkB9JudgeConsistency(questions),
    B10_no_duplicates: checkB10NoDuplicates(questions),
  };

  const warnings: string[] = [];
  for (const [name, result] of Object.entries(checks)) {
    if (!result.passed && result.questions) {
      for (const qId of result.questions) {
        warnings.push(`${qId}: ${name} check failed`);
      }
    }
  }

  const recommendation = buildRecommendation(checks, warnings);
  const passed = recommendation.startsWith("PROCEED") && !recommendation.includes("CAUTION");

  const report: QualityReport = {
    passed,
    totalQuestions: questions.length,
    goldenSetPath: GOLDEN_SET_DB_PATH,
    checks,
    warnings,
    recommendation,
  };

  logger.info(`[B Quality] Complete: ${recommendation}`);
  return report;
}

// ── C Stage: Clean failing questions ──────────────────

/** 从质量报告中收集不合格题目 ID（硬删除 + 软删除） */
function collectFailingIds(report: QualityReport): Set<string> {
  const ids = new Set<string>();

  // 硬删除：数据本身有问题
  for (const key of ["B3_query_quality", "B4_answer_quality", "B5_facts_quality", "B10_no_duplicates"] as const) {
    const check = report.checks[key];
    if (!check.passed && check.questions) {
      for (const id of check.questions) ids.add(id);
    }
  }

  // 软删除：grading 可信度问题（B7/B8/B9）
  for (const key of ["B7_grading_distribution", "B8_min_grade", "B9_judge_consistency"] as const) {
    const check = report.checks[key];
    if (!check.passed && check.questions) {
      for (const id of check.questions) ids.add(id);
    }
  }

  return ids;
}

/**
 * C 阶段：清理不合格题目。
 *
 * 1. 执行 B 阶段质量检查
 * 2. 收集不合格题目 ID
 * 3. 从 DB 删除
 * 4. 返回清理结果
 */
export function cleanGoldenSet(): {
  deleted: string[];
  kept: number;
  qualityReport: QualityReport;
} {
  const report = evaluateGoldenSetQuality();
  const failingIds = collectFailingIds(report);

  if (failingIds.size === 0) {
    logger.info("[C Clean] No failing questions to remove");
    return { deleted: [], kept: report.totalQuestions, qualityReport: report };
  }

  const db = getSyncDb();
  const placeholders = Array.from(failingIds).map(() => "?").join(",");
  db.prepare(`DELETE FROM metrics_golden_set WHERE id IN (${placeholders})`).run(...failingIds);

  logger.info(`[C Clean] Deleted ${failingIds.size} failing questions, kept ${report.totalQuestions - failingIds.size}`);
  return {
    deleted: Array.from(failingIds),
    kept: report.totalQuestions - failingIds.size,
    qualityReport: report,
  };
}
