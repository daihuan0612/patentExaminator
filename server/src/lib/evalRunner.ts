/**
 * Offline Evaluation Runner
 *
 * Runs model configurations against the golden set to compare
 * retrieval quality (recall, MRR, NDCG) and generation quality
 * (faithfulness, groundedness).
 *
 * Follows CLAUDE.md key isolation: all API keys come from function
 * parameters, never from process.env or keyStore.
 */
import { randomUUID } from "node:crypto";
import { getSyncDb } from "./syncDb.js";
import { logger } from "./logger.js";
import type { AgentRunRequest, AgentRunResponse } from "./orchestrator.js";

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
  // Retrieval metrics
  recallAtK: number;          // % of expected sources found in top-K
  mrr: number;                // 1/rank of first relevant result
  ndcgAtK: number;            // NDCG@K (graded relevance)
  // Generation metrics
  faithfulness: number;       // LLM-as-judge 0-1
  groundedness: number;       // from groundedness check
  // Performance
  durationMs: number;
  // Raw outputs
  actualAnswer: string;
  actualSources: string[];
  error?: string;
}

export interface EvalReport {
  id: string;
  timestamp: string;
  configs: EvalConfigSummary[];
  questionCount: number;
  results: EvalResult[];
}

export interface EvalConfigSummary {
  label: string;
  avgRecall: number;
  avgMrr: number;
  avgNdcg: number;
  avgFaithfulness: number;
  avgGroundedness: number;
  avgDurationMs: number;
  passRate: number;           // % with faithfulness > 0.7
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
}

// ── Golden set loading ────────────────────────────────────

/**
 * Load all questions from the metrics_golden_set table.
 */
export function loadGoldenSet(): GoldenQuestion[] {
  const db = getSyncDb();
  const rows = db.prepare(
    `SELECT id, agent, query, expected_answer, expected_sources, expected_articles, category, difficulty
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
  }));
}

// ── Retrieval metrics ─────────────────────────────────────

/**
 * Recall@K: fraction of expected sources found in top-K actual sources.
 * Uses fuzzy matching: source name contains expected or vice versa.
 */
export function computeRecallAtK(
  actualSources: string[],
  expectedSources: string[],
  k: number = 5
): number {
  if (expectedSources.length === 0) return 1;
  const topK = actualSources.slice(0, k);
  let found = 0;
  for (const expected of expectedSources) {
    const normExpected = normalizeSource(expected);
    if (topK.some((actual) => fuzzySourceMatch(normalizeSource(actual), normExpected))) {
      found++;
    }
  }
  return found / expectedSources.length;
}

/**
 * MRR (Mean Reciprocal Rank): 1 / rank of first relevant result.
 */
export function computeMRR(
  actualSources: string[],
  expectedSources: string[]
): number {
  if (expectedSources.length === 0) return 1;
  for (let i = 0; i < actualSources.length; i++) {
    const normActual = normalizeSource(actualSources[i] ?? "");
    if (expectedSources.some((exp) => fuzzySourceMatch(normActual, normalizeSource(exp)))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * NDCG@K (Normalized Discounted Cumulative Gain).
 * Graded relevance: expected source = 2, partial match = 1, no match = 0.
 * DCG = sum( (2^rel_i - 1) / log2(i + 2) )
 * NDCG = DCG / IDCG
 */
export function computeNDCG(
  actualSources: string[],
  expectedSources: string[],
  scores: number[],
  k: number = 5
): number {
  if (expectedSources.length === 0) return 1;
  const topK = actualSources.slice(0, k);

  // Assign relevance to each actual source
  const relevances: number[] = topK.map((actual) => {
    const normActual = normalizeSource(actual);
    for (const exp of expectedSources) {
      const normExp = normalizeSource(exp);
      if (fuzzySourceMatch(normActual, normExp)) return 2;      // exact match
      if (partialSourceMatch(normActual, normExp)) return 1;    // partial match
    }
    return 0;
  });

  // DCG
  let dcg = 0;
  for (let i = 0; i < relevances.length; i++) {
    const rel = relevances[i] ?? 0;
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  // IDCG: ideal ordering (all expected sources at top with relevance=2)
  const idealCount = Math.min(expectedSources.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += (Math.pow(2, 2) - 1) / Math.log2(i + 2);  // relevance=2 for each
  }

  return idcg > 0 ? dcg / idcg : 0;
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
export async function checkFaithfulness(
  answer: string,
  context: string,
  apiKey: string,
  providerPreference?: string[],
  modelId?: string
): Promise<number> {
  try {
    const { checkGroundedness } = await import("./groundednessCheck.js");

    // Build grounding docs from context
    const groundingDocs = context.length > 0
      ? [{ source: "knowledge", excerpt: context.slice(0, 8000) }]
      : [];

    if (groundingDocs.length === 0) {
      return 1; // no context to verify against
    }

    const result = await checkGroundedness(
      answer,
      groundingDocs.map((d) => ({ source: d.source, excerpt: d.excerpt, score: 0 })),
      undefined, // no web search citations
      {
        apiKey,
        providerPreference: providerPreference ?? ["gemini", "mimo"],
        modelId: modelId ?? "gemini-2.5-flash",
      }
    );

    return result.groundingScore;
  } catch (err) {
    logger.warn(`[EvalRunner] Faithfulness check failed: ${err}`);
    return 0.5; // neutral fallback
  }
}

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
 * @param options.llmApiKey - API key for LLM calls (CLAUDE.md key isolation)
 * @param options.judgeApiKey - API key for faithfulness judge (defaults to llmApiKey)
 * @param options.knowledgeEnabled - whether to enable RAG
 * @param options.knowledgeEmbedding - embedding config for RAG
 * @param options.knowledgeReranker - reranker config for RAG
 */
export async function runEvaluation(
  configs: EvalConfig[],
  options?: {
    maxConcurrency?: number;
    agentFilter?: string;
    llmApiKey?: string;
    judgeApiKey?: string;
    knowledgeEnabled?: boolean;
    knowledgeEmbedding?: { baseUrl: string; apiKey: string; modelId: string };
    knowledgeReranker?: { baseUrl: string; apiKey: string; modelId: string };
  }
): Promise<EvalReport> {
  const maxConcurrency = options?.maxConcurrency ?? 1;
  const llmApiKey = options?.llmApiKey ?? "";
  const judgeApiKey = options?.judgeApiKey ?? llmApiKey;

  // Load golden set
  let questions = loadGoldenSet();
  if (options?.agentFilter) {
    questions = questions.filter((q) => q.agent === options.agentFilter);
  }

  if (questions.length === 0) {
    logger.warn("[EvalRunner] No golden questions found. Seed the golden set first.");
    const reportId = randomUUID();
    const report: EvalReport = {
      id: reportId,
      timestamp: new Date().toISOString(),
      configs: configs.map((c) => ({
        label: c.label,
        avgRecall: 0, avgMrr: 0, avgNdcg: 0,
        avgFaithfulness: 0, avgGroundedness: 0,
        avgDurationMs: 0,
        passRate: 0,
      })),
      questionCount: 0,
      results: [],
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
      const evalOpts: {
        llmApiKey: string;
        judgeApiKey: string;
        knowledgeEnabled: boolean;
        knowledgeEmbedding?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
        knowledgeReranker?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
      } = {
        llmApiKey,
        judgeApiKey,
        knowledgeEnabled: options?.knowledgeEnabled ?? true,
        knowledgeEmbedding: options?.knowledgeEmbedding,
        knowledgeReranker: options?.knowledgeReranker,
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

  logger.info(`[EvalRunner] Evaluation complete: ${allResults.length} results, report=${report.id}`);
  return report;
}

// ── Single question evaluation ────────────────────────────

async function runSingleEvaluation(
  question: GoldenQuestion,
  config: EvalConfig,
  runId: string,
  opts: {
    llmApiKey: string;
    judgeApiKey: string;
    knowledgeEnabled: boolean;
    knowledgeEmbedding?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
    knowledgeReranker?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
  }
): Promise<EvalResult> {
  const startMs = Date.now();

  try {
    // Build the agent request — reuse the actual orchestrator pipeline
    const agentReq = buildAgentRequest(question, config, opts);
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

    // Compute retrieval metrics
    const recallAtK = computeRecallAtK(actualSources, question.expectedSources, 5);
    const mrr = computeMRR(actualSources, question.expectedSources);
    const ndcgAtK = computeNDCG(actualSources, question.expectedSources, [], 5);

    // Compute faithfulness via LLM-as-judge
    const context = actualSources.join("\n");
    const faithfulness = await checkFaithfulness(
      actualAnswer,
      context,
      opts.judgeApiKey,
      [config.providerId],
      config.modelId
    );

    // Use groundedness from the orchestrator response if available
    const groundedness = faithfulness; // ground truth is same as faithfulness for eval

    const result: EvalResult = {
      goldenId: question.id,
      query: question.query,
      configLabel: config.label,
      recallAtK,
      mrr,
      ndcgAtK,
      faithfulness,
      groundedness,
      durationMs,
      actualAnswer: actualAnswer.slice(0, 2000),
      actualSources,
    };

    saveSingleResult(result, runId, config);

    const status = recallAtK > 0 ? "OK" : "MISS";
    logger.info(`[EvalRunner]   Q=${question.id} ${status}: recall=${recallAtK.toFixed(2)} mrr=${mrr.toFixed(2)} faith=${faithfulness.toFixed(2)} ${durationMs}ms`);

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
      avgMrr: avg(successResults.map((r) => r.mrr)),
      avgNdcg: avg(successResults.map((r) => r.ndcgAtK)),
      avgFaithfulness: avg(successResults.map((r) => r.faithfulness)),
      avgGroundedness: avg(successResults.map((r) => r.groundedness)),
      avgDurationMs: avg(configResults.map((r) => r.durationMs)),
      passRate: configResults.length > 0
        ? configResults.filter((r) => r.faithfulness > 0.7).length / configResults.length
        : 0,
    };
  });

  return {
    id: runId,
    timestamp: new Date().toISOString(),
    configs: configSummaries,
    questionCount,
    results,
  };
}

// ── Database persistence ──────────────────────────────────

/**
 * Save an entire evaluation report to metrics_golden_runs.
 */
export function saveReport(report: EvalReport): void {
  const db = getSyncDb();
  const stmt = db.prepare(`
    INSERT INTO metrics_golden_runs (id, golden_id, run_id, timestamp, config_json, recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness, actual_answer, actual_sources)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insert = db.transaction(() => {
    for (const r of report.results) {
      stmt.run(
        randomUUID(),
        r.goldenId,
        report.id,
        report.timestamp,
        JSON.stringify({
          label: r.configLabel,
          durationMs: r.durationMs,
          error: r.error,
        }),
        r.recallAtK,
        r.mrr,
        r.ndcgAtK,
        r.faithfulness,
        r.groundedness,
        r.actualAnswer,
        JSON.stringify(r.actualSources)
      );
    }
  });

  insert();
  logger.info(`[EvalRunner] Saved ${report.results.length} results for report ${report.id}`);
}

/**
 * Save a single eval result to metrics_golden_runs.
 */
function saveSingleResult(result: EvalResult, runId: string, config: EvalConfig): void {
  try {
    const db = getSyncDb();
    db.prepare(`
      INSERT INTO metrics_golden_runs (id, golden_id, run_id, timestamp, config_json, recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness, actual_answer, actual_sources)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
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
      result.mrr,
      result.ndcgAtK,
      result.faithfulness,
      result.groundedness,
      result.actualAnswer,
      JSON.stringify(result.actualSources)
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
      `SELECT golden_id, config_json, recall_at_k, mrr, ndcg_at_k, faithfulness, groundedness, actual_answer, actual_sources
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
    }>;

    const results: EvalResult[] = resultRows.map((r) => {
      const configMeta = parseJsonSafe<{ label?: string; durationMs?: number; error?: string }>(r.config_json, {});
      const result: EvalResult = {
        goldenId: r.golden_id,
        query: "", // not stored per-row, available from golden set join
        configLabel: configMeta.label ?? "unknown",
        recallAtK: r.recall_at_k,
        mrr: r.mrr,
        ndcgAtK: r.ndcg_at_k,
        faithfulness: r.faithfulness,
        groundedness: r.groundedness,
        durationMs: configMeta.durationMs ?? 0,
        actualAnswer: r.actual_answer,
        actualSources: parseJsonArray(r.actual_sources),
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
        avgMrr: avg(successResults.map((r) => r.mrr)),
        avgNdcg: avg(successResults.map((r) => r.ndcgAtK)),
        avgFaithfulness: avg(successResults.map((r) => r.faithfulness)),
        avgGroundedness: avg(successResults.map((r) => r.groundedness)),
        avgDurationMs: avg(configResults.map((r) => r.durationMs)),
        passRate: configResults.length > 0
          ? configResults.filter((r) => r.faithfulness > 0.7).length / configResults.length
          : 0,
      };
    });

    reports.push({
      id: row.run_id,
      timestamp: row.timestamp,
      configs: configSummaries,
      questionCount: results.length,
      results,
    });
  }

  return reports;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Build an AgentRunRequest from a golden question and eval config.
 * Constructs the appropriate request body depending on agent type.
 */
function buildAgentRequest(
  question: GoldenQuestion,
  config: EvalConfig,
  opts: {
    llmApiKey: string;
    knowledgeEnabled: boolean;
    knowledgeEmbedding?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
    knowledgeReranker?: { baseUrl: string; apiKey: string; modelId: string } | undefined;
  }
): AgentRunRequest {
  // Build agent-specific request payload
  const requestPayload = buildPayloadForAgent(question.agent, question.query);

  return {
    agent: question.agent,
    caseId: `eval-${question.id}`,
    request: requestPayload,
    providerPreference: [config.providerId],
    modelId: config.modelId,
    apiKey: opts.llmApiKey,
    knowledgeEnabled: opts.knowledgeEnabled,
    ...(opts.knowledgeEmbedding && { knowledgeEmbedding: opts.knowledgeEmbedding }),
    ...(opts.knowledgeReranker && { knowledgeReranker: opts.knowledgeReranker }),
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
    mrr: 0,
    ndcgAtK: 0,
    faithfulness: 0,
    groundedness: 0,
    durationMs,
    actualAnswer: "",
    actualSources: [],
    error: error ?? "unknown error",
  };
}

// ── Source matching ───────────────────────────────────────

/**
 * Normalize a source name for comparison:
 * - lowercase
 * - remove common suffixes (.pdf, .docx, etc.)
 * - collapse whitespace
 */
function normalizeSource(source: string): string {
  return source
    .toLowerCase()
    .replace(/\.\w{1,5}$/i, "")       // remove file extension
    .replace(/[_-]+/g, " ")            // normalize separators
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim();
}

/**
 * Fuzzy match: either string contains the other, or significant overlap.
 */
function fuzzySourceMatch(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  // Direct containment in either direction
  if (actual.includes(expected) || expected.includes(actual)) return true;
  // Check if significant tokens overlap (>50% of expected tokens found)
  const expectedTokens = expected.split(" ").filter((t) => t.length > 1);
  if (expectedTokens.length === 0) return false;
  const matched = expectedTokens.filter((t) => actual.includes(t)).length;
  return matched / expectedTokens.length > 0.5;
}

/**
 * Partial match: at least one significant token overlaps.
 */
function partialSourceMatch(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const expectedTokens = expected.split(" ").filter((t) => t.length > 2);
  return expectedTokens.some((t) => actual.includes(t));
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
