/**
 * Offline Evaluation Runner
 *
 * Runs model configurations against the golden set to compare
 * retrieval quality (recall, MRR, NDCG) and generation quality
 * (faithfulness, groundedness, answer correctness, fact coverage).
 *
 * nf5: Extended with multi-judge metrics and chunk-level relevance grading.
 *
 * Follows CLAUDE.md key isolation: all API keys come from function
 * parameters, never from process.env or keyStore.
 */
import { randomUUID } from "node:crypto";
import { getSyncDb } from "./syncDb.js";

/** 本地时间 ISO-like 格式（不带 Z 后缀） */
function localISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
import { logger } from "./logger.js";
import type { AgentRunRequest, AgentRunResponse } from "./orchestrator.js";
import type { RelevanceGrade, SourceType, ExpectedSource } from "../../../shared/src/types/metrics.js";
import { getChunksByIds } from "./knowledgeDb.js";
import {
  computeNDCGChunkLevel,
  computeRecallChunkLevel,
  computeKBHitRate,
  computeFaithfulnessMultiJudge,
  computeAnswerCorrectness,
  computeFactCoverage,
  computeArticleAccuracy,
  computeSourceRoutingAccuracy,
  computeSourceAttributionAccuracy,
  computeConflictResolution,
  computeRefusalAccuracy,
} from "./evalMetrics.js";

// ── Type definitions ──────────────────────────────────────

export interface EvalConfig {
  label: string;              // human-readable name
  providerId: string;
  modelId: string;
  searchProvider?: string;
  rerankerType?: string;
  embeddingModel?: string;
}

export interface EvalResult {
  goldenId: string;
  query: string;
  configLabel: string;
  // Chunk-level retrieval metrics（统一用 chunk-level，不再计算 file-level）
  recallAtK: number;          // chunk-level recall（基于 relevanceGrading）
  ndcgAtK: number;            // chunk-level NDCG（基于 relevanceGrading）
  // Generation metrics
  faithfulness: number;       // LLM-as-judge 0-1
  // Performance
  durationMs: number;
  // Raw outputs
  actualAnswer: string;
  actualSources: string[];
  error?: string;

  // ── nf5 指标 ──
  answerCorrectness: number;
  factCoverage: number;
  articleAccuracy: number;
  sourceRoutingAccuracy: number;
  sourceAttributionAccuracy: number;
  conflictResolution: number;
  refusalAccuracy: number;
  kbHitRate: number;
}

export interface EvalReport {
  runId: string;
  timestamp: string;
  configs: EvalConfigSummary[];
  questionCount: number;
  questionBreakdown: EvalResult[];
}

export interface EvalConfigSummary {
  label: string;
  avgRecall: number;          // chunk-level
  avgNdcg: number;            // chunk-level
  avgFaithfulness: number;
  avgDurationMs: number;
  passRate: number;           // % with faithfulness > 0.7

  // ── nf5 指标平均值 ──
  avgAnswerCorrectness: number;
  avgFactCoverage: number;
  avgArticleAccuracy: number;
  avgSourceRoutingAccuracy: number;
  avgKbHitRate: number;
}

interface GoldenQuestion {
  id: string;
  agent: string;
  query: string;
  expectedAnswer: string;
  expectedSources: string[];
  expectedArticles: string[];
  category: string;
  difficulty: string;

  // ── nf5 新增字段 ──
  sourceType: SourceType;
  expectedSource: ExpectedSource;
  sourceRoutingRationale: string;
  mustIncludeFacts: string[];
  relevanceGrading: RelevanceGrade[];
  verifiedBy: string;
}

// ── Golden set loading ────────────────────────────────────

/**
 * Load all questions from the metrics_golden_set table.
 */
export function loadGoldenSet(): GoldenQuestion[] {
  const db = getSyncDb();
  const rows = db.prepare(
    `SELECT id, agent, query, expected_answer, expected_sources, expected_articles,
            category, difficulty, source_type, expected_source, source_routing_rationale,
            must_include_facts, relevance_grading, verified_by
     FROM metrics_golden_set
     ORDER BY category, id`
  ).all() as Array<{
    id: string;
    agent: string;
    query: string;
    expected_answer: string;
    expected_sources: string;
    expected_articles: string;
    category: string;
    difficulty: string;
    source_type: string;
    expected_source: string;
    source_routing_rationale: string;
    must_include_facts: string;
    relevance_grading: string;
    verified_by: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    query: r.query,
    expectedAnswer: r.expected_answer,
    expectedSources: parseJsonArray(r.expected_sources),
    expectedArticles: parseJsonArray(r.expected_articles),
    category: r.category,
    difficulty: r.difficulty,
    sourceType: (r.source_type || "kb_only") as SourceType,
    expectedSource: (r.expected_source || "kb") as ExpectedSource,
    sourceRoutingRationale: r.source_routing_rationale || "",
    mustIncludeFacts: parseJsonArray(r.must_include_facts),
    relevanceGrading: parseJsonSafe<RelevanceGrade[]>(r.relevance_grading, []),
    verifiedBy: r.verified_by || "auto",
  }));
}

// ── Faithfulness check ────────────────────────────────────

/**
 * Use LLM-as-judge to check if answer is grounded in context.
 * Returns 0-1 score (groundedRatio from judge).
 *
 * @param answer - the generated answer
 * @param context - the knowledge context used for generation
 * @param apiKey - LLM API key for the judge call (CLAUDE.md key isolation)
 * @param providerPreference - providers to use for the judge
 * @param modelId - model for the judge call
 */
// ── Main evaluation runner ────────────────────────────────

/**
 * Run evaluation of one or more model configurations against the golden set.
 *
 * For each config x question, it calls the actual RAG pipeline via `runAgent`,
 * computes retrieval and generation metrics, and stores results in the database.
 *
 * @param configs - model configurations to evaluate
 * @param options.maxConcurrency - max parallel evaluations (default 1)
 * @param options.agentFilter - only run questions for this agent type
 * @param options.judgeApiKeys - API keys for multi-judge metrics
 */
export async function runEvaluation(
  configs: EvalConfig[],
  options?: {
    maxConcurrency?: number;
    agentFilter?: string;
    /** 每个 judge provider 的 API key（MiMo/DeepSeek/Gemini 各自独立） */
    judgeApiKeys?: Record<string, string>;
  }
): Promise<EvalReport> {
  const maxConcurrency = options?.maxConcurrency ?? 3;

  // Load golden set
  let questions = loadGoldenSet();
  if (options?.agentFilter) {
    questions = questions.filter((q) => q.agent === options.agentFilter);
  }

  if (questions.length === 0) {
    logger.warn("[EvalRunner] No golden questions found. Seed the golden set first.");
    const report: EvalReport = {
      runId: randomUUID(),
      timestamp: localISO(),
      configs: configs.map((c) => ({
        label: c.label,
        avgRecall: 0, avgNdcg: 0,
        avgFaithfulness: 0,
        avgDurationMs: 0,
        passRate: 0,
        avgAnswerCorrectness: 0, avgFactCoverage: 0,
        avgArticleAccuracy: 0, avgSourceRoutingAccuracy: 0,
        avgKbHitRate: 0,
      })),
      questionCount: 0,
      questionBreakdown: [],
    };
    return report;
  }

  logger.info(`[EvalRunner] Starting evaluation: ${configs.length} configs x ${questions.length} questions`);

  const allResults: EvalResult[] = [];
  const runId = randomUUID();

  // Execute evaluations with controlled concurrency
  for (const config of configs) {
    logger.info(`[EvalRunner] Running config: "${config.label}" (provider=${config.providerId}, model=${config.modelId})`);

    // Process questions with concurrency control
    const chunks = chunkArray(questions, maxConcurrency);
    for (const batch of chunks) {
      const evalOpts = {
        judgeApiKeys: options?.judgeApiKeys ?? {},
      };
      const batchResults = await Promise.all(
        batch.map((q) => runSingleEvaluation(q, config, runId, evalOpts))
      );
      allResults.push(...batchResults);
    }
  }

  // Generate summary report
  const report = buildReport(runId, configs, questions.length, allResults);

  // Save to database
  saveReport(report);

  logger.info(`[EvalRunner] Evaluation complete: ${allResults.length} results, report=${report.runId}`);
  return report;
}

// ── Single question evaluation ────────────────────────────

async function runSingleEvaluation(
  question: GoldenQuestion,
  config: EvalConfig,
  runId: string,
  opts: {
    judgeApiKeys: Record<string, string>;
  }
): Promise<EvalResult> {
  const startMs = Date.now();

  try {
    // Build the agent request — 只传 question，orchestrator 自动读取 production 配置
    const agentReq = buildAgentRequest(question, config);
    logger.info(`[EvalRunner]   Q=${question.id} config="${config.label}" agent=${question.agent}`);

    // Call the actual RAG pipeline
    const { runAgent } = await import("./orchestrator.js");
    const response = await runAgent(agentReq);

    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      logger.warn(`[EvalRunner]   Q=${question.id} failed: ${response.error?.message}`);
      const result = buildErrorResult(question, config, durationMs, response.error?.message);
      saveSingleResult(result, runId, config);
      return result;
    }

    // Extract answer and sources from response
    const actualAnswer = extractAnswer(response);
    const actualSources = extractSources(response);

    // ── nf5: chunk 级检索指标（统一用 chunk-level，不再计算 file-level） ──
    const retrievedChunks = extractRetrievedChunks(response);

    // 构建 graded chunk ID → text 映射，用于内容相似度 fallback matching
    const gradedChunkTexts = new Map<string, string>();
    if (question.relevanceGrading.length > 0) {
      const gradedIds = question.relevanceGrading.map(g => g.chunkId).filter(Boolean);
      if (gradedIds.length > 0) {
        try {
          const chunks = getChunksByIds(gradedIds);
          for (const c of chunks) gradedChunkTexts.set(c.id, c.text);
        } catch (e) {
          logger.warn(`[EvalRunner] Failed to load graded chunk texts: ${e}`);
        }
      }
    }

    const recallAtK = question.relevanceGrading.length > 0
      ? computeRecallChunkLevel(retrievedChunks, question.relevanceGrading, 10, 2, gradedChunkTexts)
      : 0;
    const ndcgAtK = question.relevanceGrading.length > 0
      ? computeNDCGChunkLevel(retrievedChunks, question.relevanceGrading, 10, gradedChunkTexts)
      : 0;
    const kbHitRate = question.relevanceGrading.length > 0
      ? computeKBHitRate(retrievedChunks, question.relevanceGrading, 10, gradedChunkTexts)
      : 0;

    // ── nf5: 多 Judge 生成质量指标（并行执行）──
    const context = actualSources.join("\n");
    // 4 个 judge 指标并行执行（互不依赖，串行浪费 ~60s/题）
    const [faithfulnessResult, acResult, fcResult, refusalResult] = await Promise.all([
      computeFaithfulnessMultiJudge(actualAnswer, context, opts.judgeApiKeys),
      question.expectedAnswer
        ? computeAnswerCorrectness(actualAnswer, question.expectedAnswer, opts.judgeApiKeys)
        : Promise.resolve({ aggregated: 0, judges: [] }),
      question.mustIncludeFacts.length > 0
        ? computeFactCoverage(actualAnswer, question.mustIncludeFacts, opts.judgeApiKeys)
        : Promise.resolve({ aggregated: 0, judges: [] }),
      computeRefusalAccuracy(question.sourceType, actualAnswer, opts.judgeApiKeys),
    ]);
    const faithfulness = faithfulnessResult.aggregated;
    const answerCorrectness = acResult.aggregated;
    const factCoverage = fcResult.aggregated;
    const refusalAccuracy = refusalResult.aggregated;

    // 诊断日志：每个 judge 指标的聚合详情
    const judgeResults: Array<[string, { aggregated: number; individualResults?: Array<{ providerId: string; value: number; success: boolean }>; judgeCount?: number }]> = [
      ["faithfulness", faithfulnessResult],
      ["answerCorrectness", acResult],
      ["factCoverage", fcResult],
      ["refusalAccuracy", refusalResult],
    ];
    for (const [name, res] of judgeResults) {
      const judges = res.individualResults?.map((r: { providerId: string; value: number; success: boolean }) => `${r.providerId}=${r.value}(${r.success ? "ok" : "fail"})`).join(", ") ?? "skipped";
      logger.info(`[EvalRunner]   ${name}: aggregated=${res.aggregated}, judges=[${judges}], count=${res.judgeCount ?? 0}`);
    }

    // ── nf5: 确定性指标 ──
    const articleAccuracy = computeArticleAccuracy(actualAnswer, question.expectedArticles);

    const actualSourceFlags = {
      kb: response.knowledgeCitations ? response.knowledgeCitations.length > 0 : false,
      web: response.webSearchCitations ? response.webSearchCitations.length > 0 : false,
    };
    const sourceRoutingAccuracy = computeSourceRoutingAccuracy(
      question.expectedSource, actualSourceFlags
    );

    // Issue 1 修复：从答案文本中提取引用的来源，与实际检索到的来源对比
    const allCandidateSources = [...new Set([...question.expectedSources, ...actualSources])];
    const citedSources = extractCitedSourcesFromAnswer(actualAnswer, allCandidateSources);
    const sourceAttributionAccuracy = computeSourceAttributionAccuracy(
      citedSources, actualSources
    );

    const conflictResolution = computeConflictResolution(
      question.sourceType, question.expectedSource,
      actualSourceFlags.kb && actualSourceFlags.web ? "mixed" :
        actualSourceFlags.kb ? "kb" : "web"
    );

    const result: EvalResult = {
      goldenId: question.id,
      query: question.query,
      configLabel: config.label,
      recallAtK,
      ndcgAtK,
      faithfulness,
      durationMs,
      actualAnswer: actualAnswer.slice(0, 2000),
      actualSources,
      answerCorrectness,
      factCoverage,
      articleAccuracy,
      sourceRoutingAccuracy,
      sourceAttributionAccuracy,
      conflictResolution,
      refusalAccuracy,
      kbHitRate,
    };

    saveSingleResult(result, runId, config);

    const status = recallAtK > 0 ? "OK" : "MISS";
    logger.info(`[EvalRunner]   Q=${question.id} ${status}: recall=${recallAtK.toFixed(2)} ndcg=${ndcgAtK.toFixed(2)} faith=${faithfulness.toFixed(2)} ${durationMs}ms`);

    return result;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`[EvalRunner]   Q=${question.id} error: ${errorMsg}`);

    const result = buildErrorResult(question, config, durationMs, errorMsg);
    saveSingleResult(result, runId, config);
    return result;
  }
}

// ── Report building ───────────────────────────────────────

function buildReport(
  runId: string,
  configs: EvalConfig[],
  questionCount: number,
  results: EvalResult[]
): EvalReport {
  const configSummaries: EvalConfigSummary[] = configs.map((config) => {
    const configResults = results.filter((r) => r.configLabel === config.label);
    const successResults = configResults.filter((r) => !r.error);

    return {
      label: config.label,
      avgRecall: avg(successResults.map((r) => r.recallAtK)),
      avgNdcg: avg(successResults.map((r) => r.ndcgAtK)),
      avgFaithfulness: avg(successResults.map((r) => r.faithfulness)),
      avgDurationMs: avg(configResults.map((r) => r.durationMs)),
      passRate: configResults.length > 0
        ? configResults.filter((r) => r.faithfulness > 0.7).length / configResults.length
        : 0,
      avgAnswerCorrectness: avg(successResults.map((r) => r.answerCorrectness)),
      avgFactCoverage: avg(successResults.map((r) => r.factCoverage)),
      avgArticleAccuracy: avg(successResults.map((r) => r.articleAccuracy)),
      avgSourceRoutingAccuracy: avg(successResults.map((r) => r.sourceRoutingAccuracy)),
      avgKbHitRate: avg(successResults.map((r) => r.kbHitRate)),
    };
  });

  return {
    runId,
    timestamp: localISO(),
    configs: configSummaries,
    questionCount,
    questionBreakdown: results,
  };
}

// ── Database persistence ──────────────────────────────────

/**
 * Save an entire evaluation report to metrics_golden_runs.
 */
export function saveReport(report: EvalReport): void {
  const db = getSyncDb();
  const stmt = db.prepare(`
    INSERT INTO metrics_golden_runs (id, golden_id, run_id, timestamp, config_json,
      recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness, actual_answer, actual_sources,
      answer_correctness, fact_coverage, article_accuracy, source_routing_accuracy,
      source_attribution_accuracy, conflict_resolution, refusal_accuracy, kb_hit_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insert = db.transaction(() => {
    for (const r of report.questionBreakdown) {
      stmt.run(
        randomUUID(),
        r.goldenId,
        report.runId,
        report.timestamp,
        JSON.stringify({
          label: r.configLabel,
          durationMs: r.durationMs,
          error: r.error,
        }),
        r.recallAtK,
        0,              // mrr: 已废弃（chunk-level 不需要）
        r.ndcgAtK,
        r.faithfulness,
        0,              // groundedness: 已废弃（与 faithfulness 重复）
        r.actualAnswer,
        JSON.stringify(r.actualSources),
        r.answerCorrectness,
        r.factCoverage,
        r.articleAccuracy,
        r.sourceRoutingAccuracy,
        r.sourceAttributionAccuracy,
        r.conflictResolution,
        r.refusalAccuracy,
        r.kbHitRate
      );
    }
  });

  insert();
  logger.info(`[EvalRunner] Saved ${report.questionBreakdown.length} results for report ${report.runId}`);
}

/**
 * Save a single eval result to metrics_golden_runs.
 */
function saveSingleResult(result: EvalResult, runId: string, config: EvalConfig): void {
  try {
    const db = getSyncDb();
    db.prepare(`
      INSERT INTO metrics_golden_runs (id, golden_id, run_id, timestamp, config_json,
        recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness, actual_answer, actual_sources,
        answer_correctness, fact_coverage, article_accuracy, source_routing_accuracy,
        source_attribution_accuracy, conflict_resolution, refusal_accuracy, kb_hit_rate)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      result.goldenId,
      runId,
      JSON.stringify({
        label: config.label,
        durationMs: result.durationMs,
        error: result.error,
      }),
      result.recallAtK,
      0,              // mrr: 已废弃
      result.ndcgAtK,
      result.faithfulness,
      0,              // groundedness: 已废弃
      result.actualAnswer,
      JSON.stringify(result.actualSources),
      result.answerCorrectness,
      result.factCoverage,
      result.articleAccuracy,
      result.sourceRoutingAccuracy,
      result.sourceAttributionAccuracy,
      result.conflictResolution,
      result.refusalAccuracy,
      result.kbHitRate
    );
  } catch (err) {
    logger.warn(`[EvalRunner] Failed to save single result: ${err}`);
  }
}

/**
 * Load all past evaluation reports from metrics_golden_runs.
 */
export function getReports(): EvalReport[] {
  const db = getSyncDb();
  const rows = db.prepare(
    `SELECT DISTINCT run_id, timestamp FROM metrics_golden_runs ORDER BY timestamp DESC`
  ).all() as Array<{ run_id: string; timestamp: string }>;

  const reports: EvalReport[] = [];
  for (const row of rows) {
    const resultRows = db.prepare(
      `SELECT golden_id, config_json, recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness,
              actual_answer, actual_sources,
              answer_correctness, fact_coverage, article_accuracy, source_routing_accuracy,
              source_attribution_accuracy, conflict_resolution, refusal_accuracy, kb_hit_rate
       FROM metrics_golden_runs WHERE run_id = ? ORDER BY golden_id`
    ).all(row.run_id) as Array<{
      golden_id: string;
      config_json: string;
      recall_at_k: number;
      mrr: number;
      ndcg_at_k: number;
      faithfulness: number;
      groundedness: number;
      actual_answer: string;
      actual_sources: string;
      answer_correctness: number;
      fact_coverage: number;
      article_accuracy: number;
      source_routing_accuracy: number;
      source_attribution_accuracy: number;
      conflict_resolution: number;
      refusal_accuracy: number;
      kb_hit_rate: number;
    }>;

    const results: EvalResult[] = resultRows.map((r) => {
      const configMeta = parseJsonSafe<{ label?: string; durationMs?: number; error?: string }>(r.config_json, {});
      const result: EvalResult = {
        goldenId: r.golden_id,
        query: "", // not stored per-row, available from golden set join
        configLabel: configMeta.label ?? "unknown",
        recallAtK: r.recall_at_k,
        ndcgAtK: r.ndcg_at_k,
        faithfulness: r.faithfulness,
        durationMs: configMeta.durationMs ?? 0,
        actualAnswer: r.actual_answer,
        actualSources: parseJsonArray(r.actual_sources),
        answerCorrectness: r.answer_correctness ?? 0,
        factCoverage: r.fact_coverage ?? 0,
        articleAccuracy: r.article_accuracy ?? 0,
        sourceRoutingAccuracy: r.source_routing_accuracy ?? 0,
        sourceAttributionAccuracy: r.source_attribution_accuracy ?? 0,
        conflictResolution: r.conflict_resolution ?? 0,
        refusalAccuracy: r.refusal_accuracy ?? 0,
        kbHitRate: r.kb_hit_rate ?? 0,
      };
      if (configMeta.error !== undefined) result.error = configMeta.error;
      return result;
    });

    // Collect unique configs from results
    const configLabels = [...new Set(results.map((r) => r.configLabel))];
    const configSummaries = configLabels.map((label) => {
      const configResults = results.filter((r) => r.configLabel === label);
      const successResults = configResults.filter((r) => !r.error);
      return {
        label,
        avgRecall: avg(successResults.map((r) => r.recallAtK)),
        avgNdcg: avg(successResults.map((r) => r.ndcgAtK)),
        avgFaithfulness: avg(successResults.map((r) => r.faithfulness)),
        avgDurationMs: avg(configResults.map((r) => r.durationMs)),
        passRate: configResults.length > 0
          ? configResults.filter((r) => r.faithfulness > 0.7).length / configResults.length
          : 0,
        avgAnswerCorrectness: avg(successResults.map((r) => r.answerCorrectness)),
        avgFactCoverage: avg(successResults.map((r) => r.factCoverage)),
        avgArticleAccuracy: avg(successResults.map((r) => r.articleAccuracy)),
        avgSourceRoutingAccuracy: avg(successResults.map((r) => r.sourceRoutingAccuracy)),
        avgKbHitRate: avg(successResults.map((r) => r.kbHitRate)),
      };
    });

    reports.push({
      runId: row.run_id,
      timestamp: row.timestamp,
      configs: configSummaries,
      questionCount: results.length,
      questionBreakdown: results,
    });
  }

  return reports;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Build an AgentRunRequest from a golden question and eval config.
 * 只传 question 相关数据，其他配置由 orchestrator 从 DB 自动读取。
 */
function buildAgentRequest(
  question: GoldenQuestion,
  _config: EvalConfig,
): AgentRunRequest {
  const requestPayload = buildPayloadForAgent(question.agent, question.query);

  return {
    agent: question.agent,
    caseId: `eval-${question.id}`,
    request: requestPayload,
    // 不传 providerPreference、modelId、knowledgeEnabled、
    // knowledgeEmbedding、knowledgeReranker、searchApiKey、webSearchEnabled
    // orchestrator 从 DB 自动读取所有 production 配置
  };
}

/**
 * Build the request payload for a specific agent type.
 * Maps the golden question's query to the expected agent input format.
 */
function buildPayloadForAgent(agent: string, query: string): Record<string, unknown> {
  switch (agent) {
    case "chat":
      return { userMessage: query, caseId: "eval", moduleScope: "eval" };
    case "claim-chart":
      return { claimText: query, claimNumber: 1 };
    case "novelty":
    case "inventive":
      return { features: [{ featureCode: "A", description: query }] };
    case "defects":
      return { claimText: query };
    case "interpret":
      return { documentText: query, documentType: "application" };
    case "opinion-analysis":
      return { officeActionText: query };
    case "argument-analysis":
      return { responseText: query };
    case "reexam-draft":
      return { rejectionGrounds: [{ code: "RG-1", category: "other", summary: query }] };
    case "summary":
      return { confirmedFeatures: query };
    case "translate":
      return { documentText: query, targetLang: "中文" };
    default:
      return { userMessage: query };
  }
}

/**
 * Extract the answer text from an agent response.
 */
function extractAnswer(response: AgentRunResponse): string {
  if (!response.output) return "";
  if (typeof response.output === "string") return response.output;
  if (typeof response.output === "object" && response.output !== null) {
    const obj = response.output as Record<string, unknown>;
    // Common response shapes
    if (typeof obj.reply === "string") return obj.reply;
    if (typeof obj.body === "string") return obj.body;
    // Fallback: stringify the output
    return JSON.stringify(obj).slice(0, 4000);
  }
  return String(response.output).slice(0, 4000);
}

/**
 * Extract source names from an agent response.
 * Combines knowledge citations and web search citations.
 */
function extractSources(response: AgentRunResponse): string[] {
  const sources: string[] = [];

  if (response.knowledgeCitations) {
    for (const c of response.knowledgeCitations) {
      sources.push(c.source);
    }
  }

  if (response.webSearchCitations) {
    for (const c of response.webSearchCitations) {
      sources.push(c.title);
    }
  }

  if (response.mergedCitations) {
    for (const c of response.mergedCitations) {
      sources.push(c.title);
    }
  }

  // Deduplicate
  return [...new Set(sources)];
}

function buildErrorResult(
  question: GoldenQuestion,
  config: EvalConfig,
  durationMs: number,
  error?: string
): EvalResult {
  return {
    goldenId: question.id,
    query: question.query,
    configLabel: config.label,
    recallAtK: 0,
    ndcgAtK: 0,
    faithfulness: 0,
    durationMs,
    actualAnswer: "",
    actualSources: [],
    error: error ?? "unknown error",
    answerCorrectness: 0,
    factCoverage: 0,
    articleAccuracy: 0,
    sourceRoutingAccuracy: 0,
    sourceAttributionAccuracy: 0,
    conflictResolution: 0,
    refusalAccuracy: 0,
    kbHitRate: 0,
  };
}

/**
 * 从 agent response 中提取检索到的 chunk 信息
 * 用于 chunk 级 NDCG/Recall 计算
 */
function extractRetrievedChunks(
  response: AgentRunResponse
): Array<{ id: string; text?: string }> {
  const chunks: Array<{ id: string; text?: string }> = [];

  if (response.knowledgeCitations) {
    for (const c of response.knowledgeCitations) {
      chunks.push({ id: c.chunkId || c.sourceId || c.source || "", text: c.excerpt });
    }
  }

  if (response.webSearchCitations) {
    for (const c of response.webSearchCitations) {
      chunks.push({ id: c.url || c.title || "", text: c.snippet });
    }
  }

  if (response.mergedCitations) {
    for (const c of response.mergedCitations) {
      chunks.push({ id: c.url || c.title || "", text: c.snippet });
    }
  }

  // 去重：knowledgeCitations / webSearchCitations / mergedCitations 可能有重叠
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (!c.id || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// ── Source attribution ─────────────────────────────────────

/**
 * 从答案文本中提取引用的来源名称
 *
 * 在答案中搜索 candidateSources 里出现的来源名，
 * 返回答案实际引用的来源列表。
 * 用于 sourceAttributionAccuracy：对比"答案中引用的来源"vs"实际检索到的来源"。
 */
function extractCitedSourcesFromAnswer(
  answer: string,
  candidateSources: string[]
): string[] {
  if (!answer || candidateSources.length === 0) return [];
  const lowerAnswer = answer.toLowerCase();
  return candidateSources.filter((source) => {
    const normSource = source
      .toLowerCase()
      .replace(/\.\w{1,5}$/i, "")
      .trim();
    return normSource.length > 2 && lowerAnswer.includes(normSource);
  });
}

// ── Utility ───────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonSafe<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
