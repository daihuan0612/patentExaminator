/**
 * Golden Set E2E 证据生成测试
 * =============================
 *
 * 生成 nf5 所需的三类证据：
 * 1. Golden Set 自动测试生成
 * 2. Golden Set 生成质量 Evaluation Report
 * 3. 模型组合 Evaluation Report（用 golden set 对 LLM+Search+Embedding+Reranker 组合评测）
 *
 * 所有结果持久化到 tests/eval-reports/ 目录。
 *
 * 需要 API Key：MiMo_KEY / GEMINI_KEY / volc-key（从 .env 加载）
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  postJSON,
  getJSON,
  log,
  uploadKnowledgeFile,
  getApiKey,
  getTestBase,
  SAMPLES_KNOWLEDGE_DIR,
} from "../e2e-shared/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_REPORTS_DIR = path.join(__dirname, "..", "eval-reports");
const TIMEOUT_MS = 2_700_000; // 45 分钟（21 题 × multi-judge grading + web 搜索，每题 20-90s × 3 judges）

// ── Helpers ───────────────────────────────────────────────────────────

function ensureReportsDir() {
  fs.mkdirSync(EVAL_REPORTS_DIR, { recursive: true });
}

function saveJsonFile(filename, data) {
  ensureReportsDir();
  const filePath = path.join(EVAL_REPORTS_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[Evidence] Saved: ${filePath}`);
  return filePath;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function safeJson(res, label) {
  if (!res.ok && res.status >= 500) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Step 1: Upload Knowledge ──────────────────────────────────────────

export async function testGoldenEvalUploadKnowledge() {
  const filePath = path.join(SAMPLES_KNOWLEDGE_DIR, "专利法_2020修正.txt");
  const result = await uploadKnowledgeFile(filePath);
  log("GoldenEval: Upload knowledge", result.ok, result.ok ? "专利法_2020修正.txt" : result.error);
}

// ── Step 1.5: Write Settings to Isolated DB (BUG-3 fix) ──────────────
// Judge fallback 配置从 DB settings 读取，隔离 DB 为空需要先写入

export async function testGoldenEvalWriteSettings() {
  const mimoKey = getApiKey("mimo");
  const volcengineKey = getApiKey("volcengine");
  const tavilyKey = getApiKey("tavily");

  const providers = [];
  if (mimoKey) providers.push({ providerId: "mimo", apiKeyRef: mimoKey });
  if (volcengineKey) providers.push({ providerId: "volcengine", apiKeyRef: volcengineKey });
  // Gemini API 因超时频繁失败已暂停，替换为火山 doubao-seed（与 DeepSeek 共用 volcengine key）

  const searchProviders = [];
  if (tavilyKey) {
    searchProviders.push({ providerId: "tavily", enabled: true, apiKeyRef: tavilyKey });
  }

  if (providers.length === 0 && searchProviders.length === 0) {
    log("GoldenEval: Write settings", true, "skipped (no API keys)");
    return;
  }

  const res = await postJSON("/sync/upload", {
    stores: {
      settings: [
        { id: "app", data: { providers, searchProviders } },
      ],
    },
  });
  const data = await res.json().catch(() => ({}));
  log("GoldenEval: Write settings to isolated DB", data.ok === true,
    `providers=${providers.map(p => p.providerId).join(",")}, searchProviders=${searchProviders.map(p => p.providerId).join(",")}, fallbacks=${providers.filter(p => p.modelFallbacks).length}`);
}

// ── Step 2: Generate Golden Set ───────────────────────────────────────

export async function testGoldenEvalGenerate() {
  const mimoKey = getApiKey("mimo");
  const volcengineKey = getApiKey("volcengine");

  if (!mimoKey && !volcengineKey) {
    log("GoldenEval: Generate", true, "skipped (no API keys)");
    return null;
  }

  const providerConfigs = [];
  if (mimoKey) providerConfigs.push({ providerId: "mimo", model: "mimo-v2.5", apiKey: mimoKey, label: "MiMo" });
  if (volcengineKey) providerConfigs.push({ providerId: "volcengine", model: "deepseek-v4-flash-260425", apiKey: volcengineKey, label: "DeepSeek (火山)" });
  if (volcengineKey) providerConfigs.push({ providerId: "volcengine", model: "doubao-seed-2-0-pro-260215", apiKey: volcengineKey, label: "doubao-seed (火山)" });

  const searchApiKey = getApiKey("tavily");

  console.log(`[GoldenEval] Providers: ${providerConfigs.map(p => p.label).join(", ")}`);
  console.log(`[GoldenEval] Questions per provider: 7 (matrix allocation)`);
  console.log(`[GoldenEval] Search API key: ${searchApiKey ? "✓" : "✗ (web types will be skipped)"}`);
  console.log(`[GoldenEval] A.1 only (no grading — grading is A.2 step)`);

  const startTime = performance.now();
  const res = await postJSON("/metrics/golden-set/generate", {
    providerConfigs,
    ...(searchApiKey && { searchApiKey }),
  }, undefined, TIMEOUT_MS);
  const data = await safeJson(res, "GoldenEval Generate");
  const durationMs = performance.now() - startTime;

  const hasQuestions = data.count > 0 && Array.isArray(data.questions) && data.questions.length > 0;
  log("GoldenEval: Generate (A.1)", hasQuestions,
    hasQuestions ? `count=${data.count}, duration=${(durationMs / 1000).toFixed(1)}s` : JSON.stringify(data));

  if (!hasQuestions) return null;

  // ── Spec compliance checks (A.1) ──
  // 1. Multi-provider: 至少 2 个 provider 生成了题目
  const generatedBySet = new Set(data.questions.map(q => q.generatedBy));
  log("GoldenEval: Multi-provider generation", generatedBySet.size >= 2,
    `providers=[${[...generatedBySet].join(", ")}], count=${generatedBySet.size} (spec: ≥2)`);

  // 2. A.1 不做 grading — relevanceGrading 应为空
  const questionsWithGrading = data.questions.filter(q => (q.relevanceGrading || []).length > 0);
  log("GoldenEval: A.1 no grading (spec §5.1)", questionsWithGrading.length === 0,
    `${questionsWithGrading.length}/${data.questions.length} have grading (expected 0)`);

  // 3. SourceType 分布：至少 3 种 sourceType
  const sourceTypeSet = new Set(data.questions.map(q => q.sourceType));
  log("GoldenEval: SourceType diversity", sourceTypeSet.size >= 3,
    `types=[${[...sourceTypeSet].join(", ")}], count=${sourceTypeSet.size} (spec: ≥3)`);

  // 持久化 golden set
  const ts = timestamp();
  const goldenSetFile = saveJsonFile(`golden-set-${ts}.json`, {
    timestamp: ts.replace(/-/g, (m, offset) => offset > 9 ? ":" : m),
    providerConfigs: providerConfigs.map(p => ({ providerId: p.providerId, model: p.model, label: p.label })),
    totalQuestions: data.count,
    durationMs: Math.round(durationMs),
    questions: data.questions,
  });

  log("GoldenEval: Golden set persisted (A.1)", true, goldenSetFile);
  return data;
}

// ── Step 2.5: A.2 Relevance Grading ───────────────────────────────────

export async function testGoldenEvalGrading() {
  const mimoKey = getApiKey("mimo");
  const volcengineKey = getApiKey("volcengine");

  // 检查是否有 golden set
  const gsRes = await getJSON("/metrics/golden-set");
  const gsData = await safeJson(gsRes, "GoldenEval Grading check");
  if (gsData.count === 0) {
    log("GoldenEval: A.2 Grading", true, "skipped (no golden set)");
    return null;
  }

  // spec §5.2: 2 judge（MiMo + DeepSeek）
  const judgeApiKeys = {};
  if (mimoKey) judgeApiKeys.mimo = mimoKey;
  if (volcengineKey) judgeApiKeys.volcengine = volcengineKey;

  if (Object.keys(judgeApiKeys).length === 0) {
    log("GoldenEval: A.2 Grading", true, "skipped (no judge API keys)");
    return null;
  }

  console.log(`[GoldenEval] A.2 Grading: ${gsData.count} questions, judges=${Object.keys(judgeApiKeys).join(", ")}`);

  const startTime = performance.now();
  const res = await postJSON("/metrics/golden-set/grade", {
    judgeApiKeys,
  }, undefined, TIMEOUT_MS);
  const data = await safeJson(res, "GoldenEval A.2 Grading");
  const durationMs = performance.now() - startTime;

  const hasResults = data.graded > 0;
  log("GoldenEval: A.2 Grading", hasResults,
    hasResults
      ? `graded=${data.graded}, duration=${(durationMs / 1000).toFixed(1)}s`
      : JSON.stringify(data));

  if (!hasResults) return null;

  // Spec compliance: 每题至少 1 个 grade≥2 的候选（spec §3.1 S5）
  const gradingDetails = data.results || [];
  const withGoodGrade = gradingDetails.filter(r =>
    (r.grading || []).some(g => g.grade >= 2)
  ).length;
  log("GoldenEval: A.2 min grade≥2", withGoodGrade > 0,
    `${withGoodGrade}/${gradingDetails.length} questions have grade≥2 candidate`);

  // Judge 一致性：2 judge 打分差异 ≤ 2（spec §5.3 B9）
  let consistentCount = 0;
  for (const r of gradingDetails) {
    const grading = r.grading || [];
    let allConsistent = true;
    for (const g of grading) {
      if (g.judges && g.judges.length >= 2) {
        const grades = g.judges.filter(j => j.grade !== null).map(j => j.grade);
        if (grades.length >= 2) {
          const maxDiff = Math.max(...grades) - Math.min(...grades);
          if (maxDiff > 2) { allConsistent = false; break; }
        }
      }
    }
    if (allConsistent) consistentCount++;
  }
  log("GoldenEval: A.2 judge consistency", consistentCount === gradingDetails.length,
    `${consistentCount}/${gradingDetails.length} questions have consistent judges`);

  return data;
}

// ── Step 3: Golden Set Quality Evaluation ─────────────────────────────

export async function testGoldenEvalQuality() {
  // 调用 B 阶段质量评估 API（spec §5.3: 10 项确定性检查，不调用 LLM）
  const res = await getJSON("/metrics/golden-set/quality");
  const report = await safeJson(res, "GoldenEval Quality");

  if (report.totalQuestions === 0) {
    log("GoldenEval: B Quality report", true, "skipped (no golden set)");
    return;
  }

  const ts = timestamp();
  const reportFile = saveJsonFile(`golden-quality-${ts}.json`, report);

  // 断言（spec §5.3）
  log("GoldenEval: B Quality overall", report.passed,
    `recommendation=${report.recommendation}`);

  const checks = report.checks || {};
  log("GoldenEval: B1 count", checks.B1_count?.passed, checks.B1_count?.detail);
  log("GoldenEval: B2 matrix", checks.B2_matrix?.passed, checks.B2_matrix?.detail);
  log("GoldenEval: B3 query quality", checks.B3_query_quality?.passed, checks.B3_query_quality?.detail);
  log("GoldenEval: B4 answer quality", checks.B4_answer_quality?.passed, checks.B4_answer_quality?.detail);
  log("GoldenEval: B5 facts quality", checks.B5_facts_quality?.passed, checks.B5_facts_quality?.detail);
  log("GoldenEval: B6 grading nonempty", checks.B6_grading_nonempty?.passed, checks.B6_grading_nonempty?.detail);
  log("GoldenEval: B7 grading distribution", checks.B7_grading_distribution?.passed, checks.B7_grading_distribution?.detail);
  log("GoldenEval: B8 min grade", checks.B8_min_grade?.passed, checks.B8_min_grade?.detail);
  log("GoldenEval: B9 judge consistency", checks.B9_judge_consistency?.passed, checks.B9_judge_consistency?.detail);
  log("GoldenEval: B10 no duplicates", checks.B10_no_duplicates?.passed, checks.B10_no_duplicates?.detail);
  log("GoldenEval: Quality report persisted", true, reportFile);
}

// ── Step 4: Model Combination Evaluation ──────────────────────────────

export async function testGoldenEvalModelCombination() {
  const mimoKey = getApiKey("mimo");
  const geminiKey = getApiKey("gemini");
  const volcengineKey = getApiKey("volcengine");

  // 检查是否有 golden set
  const gsRes = await getJSON("/metrics/golden-set");
  const gsData = await safeJson(gsRes, "GoldenEval ModelCombination check");
  if (gsData.count === 0) {
    log("GoldenEval: Model combination eval", true, "skipped (no golden set)");
    return;
  }

  // 构建 eval configs — 使用主 LLM 作为 eval config（每个 question 需要 20-90s，太多 configs 会超时）
  const configs = [];
  if (mimoKey) configs.push({ label: "MiMo-v2.5", providerId: "mimo", modelId: "mimo-v2.5" });
  else if (volcengineKey) configs.push({ label: "DeepSeek-v4-flash", providerId: "volcengine", modelId: "deepseek-v4-flash-260425" });

  if (configs.length === 0) {
    log("GoldenEval: Model combination eval", true, "skipped (no API keys)");
    return;
  }

  // 使用第一个可用 key 作为主 LLM key
  const apiKey = mimoKey || volcengineKey;

  // spec §5.2: 2 judge（MiMo + DeepSeek），取平均
  const judgeApiKeys = {};
  if (mimoKey) judgeApiKeys.mimo = mimoKey;
  if (volcengineKey) judgeApiKeys.volcengine = volcengineKey;

  console.log(`[GoldenEval] Running evaluation with ${configs.length} configs against ${gsData.count} questions`);
  console.log(`[GoldenEval] Configs: ${configs.map(c => c.label).join(", ")}`);
  console.log(`[GoldenEval] Judge providers: ${Object.keys(judgeApiKeys).join(", ")} (2 judges)`);

  const startTime = performance.now();
  // 每个 question 需要 20-90s（含 RAG + groundedness + multi-judge），maxConcurrency=3 并行
  const EVAL_API_TIMEOUT = 2_700_000; // 45 分钟
  const res = await postJSON("/metrics/eval/run", {
    configs,
    maxConcurrency: 3,
    ...(Object.keys(judgeApiKeys).length > 0 && { judgeApiKeys }),
  }, undefined, EVAL_API_TIMEOUT);
  const report = await safeJson(res, "GoldenEval ModelCombination");
  const durationMs = performance.now() - startTime;

  const hasResults = report.questionCount > 0 && Array.isArray(report.questionBreakdown) && report.questionBreakdown.length > 0;
  log("GoldenEval: Model combination eval", hasResults,
    hasResults
      ? `runId=${report.runId}, questions=${report.questionCount}, configs=${report.configs?.length}, duration=${(durationMs / 1000).toFixed(1)}s`
      : JSON.stringify(report).slice(0, 200));

  if (!hasResults) return;

  // 打印 per-config 摘要
  for (const cfg of (report.configs || [])) {
    console.log(`[GoldenEval] Config "${cfg.label}":`);
    console.log(`  recall=${cfg.avgRecall?.toFixed(3)}, ndcg=${cfg.avgNdcg?.toFixed(3)}, faithfulness=${cfg.avgFaithfulness?.toFixed(3)}`);
    console.log(`  answerCorrectness=${cfg.avgAnswerCorrectness?.toFixed(3)}, factCoverage=${cfg.avgFactCoverage?.toFixed(3)}`);
    console.log(`  articleAccuracy=${cfg.avgArticleAccuracy?.toFixed(3)}, routingAccuracy=${cfg.avgSourceRoutingAccuracy?.toFixed(3)}`);
    console.log(`  kbHitRate=${cfg.avgKbHitRate?.toFixed(3)}`);
    console.log(`  passRate=${(cfg.passRate * 100).toFixed(1)}%, avgDuration=${cfg.avgDurationMs?.toFixed(0)}ms`);
  }

  // 持久化 evaluation report
  const ts = timestamp();
  const reportFile = saveJsonFile(`eval-report-${ts}.json`, {
    ...report,
    _meta: {
      generatedAt: ts.replace(/-/g, (m, offset) => offset > 9 ? ":" : m),
      totalDurationMs: Math.round(durationMs),
      configCount: configs.length,
      questionCount: report.questionCount,
    },
  });

  log("GoldenEval: Eval report persisted", true, reportFile);

  // 基本断言
  log("GoldenEval: Report has runId", !!report.runId, `runId=${report.runId}`);
  log("GoldenEval: Report has configs", (report.configs?.length || 0) > 0, `count=${report.configs?.length}`);
  log("GoldenEval: Question breakdown present", report.questionBreakdown?.length > 0, `count=${report.questionBreakdown?.length}`);

  // Spec compliance 断言（multi-judge metrics）
  for (const cfg of (report.configs || [])) {
    const hasRecall = cfg.avgRecall > 0;
    const hasNdcg = cfg.avgNdcg > 0;
    const hasFaithfulness = cfg.avgFaithfulness > 0;
    const hasFactCoverage = cfg.avgFactCoverage > 0;
    log(`GoldenEval: [${cfg.label}] recall > 0 (multi-judge grading)`, hasRecall, `avgRecall=${cfg.avgRecall?.toFixed(3)}`);
    log(`GoldenEval: [${cfg.label}] ndcg > 0 (multi-judge grading)`, hasNdcg, `avgNdcg=${cfg.avgNdcg?.toFixed(3)}`);
    log(`GoldenEval: [${cfg.label}] faithfulness > 0 (multi-judge)`, hasFaithfulness, `avgFaithfulness=${cfg.avgFaithfulness?.toFixed(3)}`);
    log(`GoldenEval: [${cfg.label}] factCoverage > 0 (multi-judge)`, hasFactCoverage, `avgFactCoverage=${cfg.avgFactCoverage?.toFixed(3)}`);
  }
}

// ── Step 5: Cleanup ───────────────────────────────────────────────────

export async function testGoldenEvalCleanup() {
  const base = getTestBase();
  const res = await fetch(`${base}/metrics/golden-set`, { method: "DELETE" });
  const data = await safeJson(res, "GoldenEval Cleanup");
  log("GoldenEval: Cleanup", data.ok === true, JSON.stringify(data));
}
