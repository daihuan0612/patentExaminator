// ── Metrics Run Record ─────────────────────────────────
// One record per agent call, persisted to metrics_runs table

export interface MetricsRun {
  id: string;
  timestamp: string;          // ISO datetime
  agent: string;              // claim-chart, novelty, chat, etc.
  caseId: string;

  // Model combination
  providerId: string;
  modelId: string;
  searchProvider: string;     // tavily, serpapi, epo, ''
  rerankerType: string;       // remote, cross-encoder, local, ''
  embeddingModel: string;     // BAAI/bge-m3, ''

  // Latency
  durationMs: number;
  ttftMs: number;             // time to first token
  toolRounds: number;

  // Token usage
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens: number;

  // RAG quality
  ragCitationCount: number;
  topCitationScore: number;   // best cosine similarity
  rerankerTopScore: number;

  // Web search
  webSearchCount: number;
  webSearchRounds: number;

  // Groundedness
  groundingScore: number;     // -1 = not checked, 0-1 = score
  groundingVerdict: string;   // pass, partial, fail, ''
  removedClaimsCount: number;

  // Outcome
  success: boolean;
  errorType: string;
  errorCode: string;

  // JSON fields
  attemptsJson: string;       // Array<{providerId, ok, errorCode}>
  timingsJson: string;        // RunTimings JSON

  // Feedback & experiments
  userFeedback: string;       // like, dislike, ''
  experimentId: string;
  variant: string;
}

// ── Per-Stage Timing Breakdown ─────────────────────────

export interface RunTimings {
  promptBuildMs: number;
  ragSearchMs: number;
  rerankMs: number;
  llmCallMs: number;
  groundednessMs: number;
  totalMs: number;
}

// ── Quality Signals from Tool Executor ──────────────────

export interface QualitySignals {
  ragTopScore: number;
  rerankerTopScore: number;
  webResultCount: number;
  toolRounds: number;
  fusionMethod: 'remote-reranker' | 'cross-encoder' | 'local-heuristic';
}

// ── API Response Types ─────────────────────────────────

export interface MetricsSummary {
  totalRuns: number;
  successRate: number;
  avgGroundedness: number;
  avgDurationMs: number;
  totalTokens: number;
  byModel: ModelMetricsRow[];
}

export interface ModelMetricsRow {
  providerId: string;
  modelId: string;
  runCount: number;
  successRate: number;
  avgGroundedness: number;
  avgDurationMs: number;
  avgTokensPerRun: number;
  avgRagScore: number;
}

export interface MetricsTrendPoint {
  date: string;
  value: number;
  count: number;
}

export interface MetricsComparison {
  configs: ComparisonColumn[];
}

export interface ComparisonColumn {
  label: string;
  providerId: string;
  modelId: string;
  runCount: number;
  avgGroundedness: number;
  avgDurationMs: number;
  successRate: number;
  avgRagScore: number;
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p99: number;
  avg: number;
  stage: string;
}

// ── Golden Evaluation Set ──────────────────────────────

/** 题目来源类型（nf5 spec §2.3） */
export type SourceType = "kb_only" | "web_only" | "cross_source" | "conflict" | "no_answer";

/** 预期答案来源 */
export type ExpectedSource = "kb" | "web" | "kb+web" | "any";

/** 验证方式 */
export type VerificationMethod = "human" | "llm-judge" | "auto";

/** Chunk 级 relevance grading（nf5 spec §2.2，TREC/NIST 0-3 标准） */
export interface RelevanceGrade {
  source: "kb" | "web";
  docId: string;
  chunkId?: string;
  grade: 0 | 1 | 2 | 3;      // 0=不相关, 1=边际, 2=部分, 3=高度相关
  rationale: string;
}

export interface GoldenQuestion {
  id: string;
  createdAt: string;
  agent: string;
  query: string;
  expectedAnswer: string;
  expectedSources: string[];    // file names
  expectedArticles: string[];   // article references
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  generatedBy: string;

  // ── nf5 新增字段 ──
  sourceType: SourceType;
  expectedSource: ExpectedSource;
  sourceRoutingRationale: string;
  mustIncludeFacts: string[];
  relevanceGrading: RelevanceGrade[];
  verifiedBy: VerificationMethod;
}

export interface GoldenRunResult {
  id: string;
  goldenId: string;
  runId: string;
  timestamp: string;
  configJson: string;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  faithfulness: number;
  groundedness: number;
  actualAnswer: string;
  actualSources: string[];

  // ── nf5 新增指标 ──
  answerCorrectness: number;          // multi-judge, 0-1
  factCoverage: number;               // multi-judge, 0-1
  articleAccuracy: number;            // deterministic, 0-1
  sourceRoutingAccuracy: number;      // deterministic, 0-1
  sourceAttributionAccuracy: number;  // deterministic, 0-1
  conflictResolution: number;         // deterministic, 0-1
  refusalAccuracy: number;            // deterministic, 0-1
  kbHitRate: number;                  // KB 专属题的 recall
  webHitRate: number;                 // Web 专属题的 recall
}

export interface EvalReport {
  runId: string;
  timestamp: string;
  configs: EvalConfigSummary[];
  questionBreakdown: EvalQuestionRow[];
}

export interface EvalConfigSummary {
  label: string;
  avgRecall: number;
  avgMrr: number;
  avgNdcg: number;
  avgFaithfulness: number;
  avgGroundedness: number;
  avgDurationMs: number;
  passRate: number;

  // ── nf5 新增指标平均值 ──
  avgAnswerCorrectness: number;
  avgFactCoverage: number;
  avgArticleAccuracy: number;
  avgSourceRoutingAccuracy: number;
  avgKbHitRate: number;
  avgWebHitRate: number;
}

export interface EvalQuestionRow {
  query: string;
  results: Array<{ configLabel: string; recall: number; mrr: number; ndcg: number }>;
}

// ── Drift Detection ────────────────────────────────────

export interface DriftAlert {
  id: string;
  agent: string;
  metric: string;
  baselineValue: number;
  currentValue: number;
  deviationSigma: number;
  detectedAt: string;
  severity: 'warning' | 'critical';
}

// ── Filters for API Queries ────────────────────────────

export interface MetricsFilters {
  agent?: string;
  providerId?: string;
  modelId?: string;
  from?: string;
  to?: string;
  experimentId?: string;
}
