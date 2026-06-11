import { Router } from "express";
import { getSyncDb } from "../lib/syncDb.js";
import { writeAudit } from "../lib/auditLog.js";

export const metricsRouter = Router();

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ── Row types ─────────────────────────────────────────────

interface SummaryRow {
  provider_id: string;
  model_id: string;
  search_provider: string;
  reranker_type: string;
  embedding_model: string;
  run_count: number;
  success_rate: number;
  avg_groundedness: number | null;
  avg_duration_ms: number;
  avg_rag_score: number | null;
  avg_ttft_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_web_top_score: number;
  avg_fusion_top_score: number;
  avg_tool_rounds: number;
}

interface TrendRow {
  bucket: string;
  avg_value: number;
  sample_count: number;
}

interface DurationRow {
  duration_ms: number;
}

interface TtftRow {
  ttft_ms: number;
}

interface ComparisonRow {
  run_count: number;
  success_rate: number;
  avg_groundedness: number | null;
  avg_duration: number;
  avg_rag_score: number | null;
}

interface AgentRow {
  agent: string;
  count: number;
}

interface ReportRow {
  id: string;
  timestamp: string;
  config_json: string;
}

// GET /api/metrics/by-dimension?dimension=provider_id&agent=&from=&to=
// Returns aggregated metrics grouped by a single dimension
const ALLOWED_DIMENSIONS: Record<string, string> = {
  provider_id: "provider_id",
  model_id: "model_id",
  search_provider: "search_provider",
  reranker_type: "reranker_type",
  embedding_model: "embedding_model",
  agent: "agent",
};

interface DimRow {
  dimension_value: string;
  run_count: number;
  success_rate: number;
  avg_groundedness: number | null;
  avg_duration_ms: number;
  avg_rag_score: number | null;
  avg_ttft_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_web_top_score: number;
  avg_fusion_top_score: number;
  avg_tool_rounds: number;
}

metricsRouter.get("/metrics/by-dimension", (req, res) => {
  try {
    const db = getSyncDb();
    const dim = (req.query.dimension as string) || "provider_id";
    const column = ALLOWED_DIMENSIONS[dim];
    if (!column) {
      res.status(400).json({ error: `Invalid dimension: ${dim}. Allowed: ${Object.keys(ALLOWED_DIMENSIONS).join(", ")}` });
      return;
    }
    const agent = req.query.agent as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: string[] = [];
    const params: string[] = [];
    if (agent) { conditions.push("agent = ?"); params.push(agent); }
    if (from) { conditions.push("timestamp >= ?"); params.push(from); }
    if (to) { conditions.push("timestamp <= ?"); params.push(to); }
    // 过滤掉不适用的维度值（如搜索操作没有 reranker/embedding）
    conditions.push(`${column} != ''`);
    const where = `WHERE ${conditions.join(" AND ")}`;

    // 耗时 = 组件级端到端延迟（从 timings_json 提取）
    // A(LLM)→llmCallMs, B(Search)→total-llm-rag-gnd, C/D→ragSearchMs
    const dimTimingKey: Record<string, string> = {
      provider_id: "llmCallMs",
      search_provider: "__other__",
      reranker_type: "ragSearchMs",
      embedding_model: "ragSearchMs",
    };
    const timingKey = dimTimingKey[dim] || "";

    // LLM Provider 维度按 provider_id + model_id 分组，显示为 "provider:model"
    const dimExpr = dim === "provider_id"
      ? `CASE WHEN provider_id = '' THEN '（未知）' ELSE provider_id END || ':' || model_id`
      : `CASE WHEN ${column} = '' THEN '（未知）' ELSE ${column} END`;

    // Step 1: aggregated stats
    const aggRows = db.prepare(`
      SELECT
        ${dimExpr} as dimension_value,
        COUNT(*) as run_count,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG(CASE WHEN grounding_score >= 0 THEN grounding_score END) as avg_groundedness,
        AVG(top_citation_score) as avg_rag_score,
        AVG(ttft_ms) as avg_ttft_ms,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        AVG(web_top_score) as avg_web_top_score,
        AVG(fusion_top_score) as avg_fusion_top_score,
        AVG(tool_rounds) as avg_tool_rounds
      FROM metrics_runs ${where}
      GROUP BY ${dimExpr}
      ORDER BY run_count DESC
    `).all(...params) as DimRow[];

    // Step 2: per-component latency from timings_json
    const componentLatency: Record<string, number> = {};
    if (timingKey) {
      const timingRows = db.prepare(`
        SELECT
          ${dimExpr} as dv,
          timings_json
        FROM metrics_runs ${where}
      `).all(...params) as Array<{ dv: string; timings_json: string }>;

      const buckets: Record<string, number[]> = {};
      for (const r of timingRows) {
        try {
          const t = JSON.parse(r.timings_json) as Record<string, number>;
          let val: number;
          if (timingKey === "__other__") {
            // Search: total - llm - rag - groundedness = web search time
            val = (t.totalMs ?? 0) - (t.llmCallMs ?? 0) - (t.ragSearchMs ?? 0) - (t.groundednessMs ?? 0);
            val = Math.max(0, val);
          } else {
            val = t[timingKey] ?? 0;
          }
          if (!buckets[r.dv]) buckets[r.dv] = [];
          buckets[r.dv].push(val);
        } catch { /* skip malformed */ }
      }
      for (const [dv, vals] of Object.entries(buckets)) {
        componentLatency[dv] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
    }

    // Step 3: merge
    const rows: DimRow[] = aggRows.map((row) => ({
      ...row,
      avg_duration_ms: timingKey ? (componentLatency[row.dimension_value] ?? 0) : 0,
    }));

    res.json({ dimension: dim, rows: rows || [] });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/summary?agent=&from=&to=
// Returns aggregated metrics by model combination
metricsRouter.get("/metrics/summary", (req, res) => {
  try {
    const db = getSyncDb();
    const agent = req.query.agent as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: string[] = [];
    const params: string[] = [];
    if (agent) { conditions.push("agent = ?"); params.push(agent); }
    if (from) { conditions.push("timestamp >= ?"); params.push(from); }
    if (to) { conditions.push("timestamp <= ?"); params.push(to); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        provider_id,
        model_id,
        search_provider,
        reranker_type,
        embedding_model,
        COUNT(*) as run_count,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
        AVG(CASE WHEN grounding_score >= 0 THEN grounding_score END) as avg_groundedness,
        AVG(duration_ms) as avg_duration_ms,
        AVG(top_citation_score) as avg_rag_score,
        AVG(ttft_ms) as avg_ttft_ms,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        AVG(web_top_score) as avg_web_top_score,
        AVG(fusion_top_score) as avg_fusion_top_score,
        AVG(tool_rounds) as avg_tool_rounds
      FROM metrics_runs ${where}
      GROUP BY provider_id, model_id, search_provider, reranker_type, embedding_model
      ORDER BY run_count DESC
    `).all(...params) as SummaryRow[];

    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/trends?metric=groundedness&agent=&granularity=day
// Returns time-series data
metricsRouter.get("/metrics/trends", (req, res) => {
  try {
    const db = getSyncDb();
    const metric = (req.query.metric as string) || "groundedness";
    const agent = req.query.agent as string | undefined;
    const granularity = (req.query.granularity as string) || "day";

    // Map metric name to column
    const metricColumnMap: Record<string, string> = {
      groundedness: "grounding_score",
      duration: "duration_ms",
      ttft: "ttft_ms",
      rag_score: "top_citation_score",
      success_rate: "CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END",
      token_usage: "total_tokens",
    };
    const column = metricColumnMap[metric] || "grounding_score";

    // Map granularity to SQLite date format
    const granularityMap: Record<string, string> = {
      hour: "%Y-%m-%dT%H:00:00",
      day: "%Y-%m-%d",
      week: "%Y-W%W",
      month: "%Y-%m",
    };
    const dateFormat = granularityMap[granularity] || "%Y-%m-%d";

    const conditions: string[] = [];
    const params: string[] = [];
    if (agent) { conditions.push("agent = ?"); params.push(agent); }
    // Only include rows where the metric is meaningful (>= 0 for grounding_score)
    if (metric === "groundedness") { conditions.push("grounding_score >= 0"); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        strftime('${dateFormat}', timestamp) as bucket,
        AVG(${column}) as avg_value,
        COUNT(*) as sample_count
      FROM metrics_runs ${where}
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(...params) as TrendRow[];

    res.json({
      metric,
      granularity,
      data: rows || [],
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/latency?agent=
// Returns latency percentiles per pipeline stage
metricsRouter.get("/metrics/latency", (req, res) => {
  try {
    const db = getSyncDb();
    const agent = req.query.agent as string | undefined;

    const conditions: string[] = [];
    const params: string[] = [];
    if (agent) { conditions.push("agent = ?"); params.push(agent); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Overall latency percentiles
    const allDurations = db.prepare(`
      SELECT duration_ms FROM metrics_runs ${where} ORDER BY duration_ms ASC
    `).all(...params) as DurationRow[];

    // TTFT percentiles
    const ttftConditions = [...conditions, "ttft_ms > 0"];
    const ttftWhere = ttftConditions.length > 0 ? `WHERE ${ttftConditions.join(" AND ")}` : "";
    const allTtft = db.prepare(`
      SELECT ttft_ms FROM metrics_runs ${ttftWhere} ORDER BY ttft_ms ASC
    `).all(...params) as TtftRow[];

    const durations = allDurations.map(r => r.duration_ms);
    const ttfts = allTtft.map(r => r.ttft_ms);

    res.json({
      duration: {
        p50: percentile(durations, 50),
        p75: percentile(durations, 75),
        p90: percentile(durations, 90),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
        count: durations.length,
      },
      ttft: {
        p50: percentile(ttfts, 50),
        p75: percentile(ttfts, 75),
        p90: percentile(ttfts, 90),
        p95: percentile(ttfts, 95),
        p99: percentile(ttfts, 99),
        count: ttfts.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/comparison?agent=&configs=gemini:gemini-2.5-flash,mimo:mimo-v2.5-pro
// Returns side-by-side comparison of model combinations
metricsRouter.get("/metrics/comparison", (req, res) => {
  try {
    const db = getSyncDb();
    const agent = req.query.agent as string | undefined;
    const configsStr = req.query.configs as string | undefined;

    if (!configsStr) {
      res.status(400).json({ error: "configs parameter required" });
      return;
    }

    const configs = configsStr.split(",").map(c => {
      const [providerId, modelId] = c.trim().split(":");
      return { providerId, modelId };
    });

    const results = configs.map(({ providerId, modelId }) => {
      const where = ["provider_id = ?", "model_id = ?"];
      const params: string[] = [providerId ?? "", modelId ?? ""];
      if (agent) { where.push("agent = ?"); params.push(agent); }

      const row = db.prepare(`
        SELECT COUNT(*) as run_count,
               AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) as success_rate,
               AVG(CASE WHEN grounding_score >= 0 THEN grounding_score END) as avg_groundedness,
               AVG(duration_ms) as avg_duration,
               AVG(top_citation_score) as avg_rag_score
        FROM metrics_runs WHERE ${where.join(" AND ")}
      `).get(...params) as ComparisonRow | undefined;

      return {
        label: `${providerId}:${modelId}`,
        providerId,
        modelId,
        runCount: row?.run_count || 0,
        successRate: row?.success_rate || 0,
        avgGroundedness: row?.avg_groundedness || 0,
        avgDurationMs: row?.avg_duration || 0,
        avgRagScore: row?.avg_rag_score || 0,
      };
    });

    res.json({ configs: results });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/latency-breakdown?agent=
// Returns average time breakdown: LLM waiting (promptBuild+ragSearch+rerank+llmCall) vs groundedness check
metricsRouter.get("/metrics/latency-breakdown", (req, res) => {
  try {
    const db = getSyncDb();
    const agent = req.query.agent as string | undefined;

    const conditions: string[] = ["timings_json IS NOT NULL", "timings_json != '{}'"];
    const params: string[] = [];
    if (agent) { conditions.push("agent = ?"); params.push(agent); }
    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = db.prepare(`
      SELECT timings_json FROM metrics_runs ${where}
    `).all(...params) as Array<{ timings_json: string }>;

    let totalLlmWait = 0;
    let totalGroundedness = 0;
    let totalOther = 0;
    let count = 0;

    for (const row of rows) {
      try {
        const t = JSON.parse(row.timings_json) as Record<string, number>;
        const llmWait = (t.promptBuildMs ?? 0) + (t.ragSearchMs ?? 0) + (t.rerankMs ?? 0) + (t.llmCallMs ?? 0);
        const gnd = t.groundednessMs ?? 0;
        const total = t.totalMs ?? (llmWait + gnd);
        const other = Math.max(0, total - llmWait - gnd);
        totalLlmWait += llmWait;
        totalGroundedness += gnd;
        totalOther += other;
        count++;
      } catch { /* skip malformed JSON */ }
    }

    if (count === 0) {
      res.json({ llmWaitMs: 0, groundednessMs: 0, otherMs: 0, count: 0 });
      return;
    }

    res.json({
      llmWaitMs: Math.round(totalLlmWait / count),
      groundednessMs: Math.round(totalGroundedness / count),
      otherMs: Math.round(totalOther / count),
      count,
    });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/agents
// Returns list of distinct agents that have metrics
metricsRouter.get("/metrics/agents", (_req, res) => {
  try {
    const db = getSyncDb();
    const rows = db.prepare(`
      SELECT DISTINCT agent, COUNT(*) as count
      FROM metrics_runs GROUP BY agent ORDER BY count DESC
    `).all() as AgentRow[];
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/metrics/golden-set/generate
// Generate golden evaluation set using 3 free LLMs
// Body: { apiKeys: { mimo: string, deepseek: string, gemini: string } }
metricsRouter.post("/metrics/golden-set/generate", async (req, res) => {
  try {
    const { apiKeys } = req.body as { apiKeys?: Record<string, string> };
    if (!apiKeys?.mimo || !apiKeys?.deepseek || !apiKeys?.gemini) {
      return res.status(400).json({ error: "需要提供 mimo、deepseek、gemini 三个 API key" });
    }
    const { generateGoldenSet } = await import("../lib/goldenSetGenerator.js");
    const questions = await generateGoldenSet(apiKeys);
    writeAudit({ op: "CREATE", store: "metrics_golden_set", caller: "user", dataAfter: { count: questions.length } });
    res.json({ count: questions.length, questions });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/golden-set
// Get existing golden set
metricsRouter.get("/metrics/golden-set", async (_req, res) => {
  try {
    const { getGoldenSet } = await import("../lib/goldenSetGenerator.js");
    const questions = await getGoldenSet();
    res.json({ count: questions.length, questions });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// DELETE /api/metrics/golden-set
// Clear golden set for regeneration
metricsRouter.delete("/metrics/golden-set", async (_req, res) => {
  try {
    const { clearGoldenSet, getGoldenSetStats } = await import("../lib/goldenSetGenerator.js");
    const before = await getGoldenSetStats();
    await clearGoldenSet();
    writeAudit({ op: "DELETE_ALL", store: "metrics_golden_set", caller: "user", dataBefore: before });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// POST /api/metrics/eval/run
// Run offline evaluation
// Body: { configs: EvalConfig[], apiKey: string, agentFilter?: string }
metricsRouter.post("/metrics/eval/run", async (req, res) => {
  try {
    const { configs, apiKey, agentFilter } = req.body as {
      configs?: unknown[];
      apiKey?: string;
      agentFilter?: string;
    };
    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({ error: "需要提供至少一个模型配置" });
    }
    if (!apiKey) {
      return res.status(400).json({ error: "需要提供 API key" });
    }
    const { runEvaluation } = await import("../lib/evalRunner.js");
    const report = await runEvaluation(configs, {
      llmApiKey: apiKey,
      agentFilter,
    });
    writeAudit({
      op: "CREATE",
      store: "metrics_golden_runs",
      caller: "user",
      dataAfter: { id: report.id, configCount: report.configs.length, questionCount: report.questionCount },
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// GET /api/metrics/eval/reports
// Get past evaluation reports
metricsRouter.get("/metrics/eval/reports", async (_req, res) => {
  try {
    const db = getSyncDb();
    const rows = db.prepare(`
      SELECT DISTINCT id, timestamp, config_json
      FROM metrics_golden_runs
      ORDER BY timestamp DESC LIMIT 20
    `).all() as ReportRow[];
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});
