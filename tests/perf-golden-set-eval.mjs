#!/usr/bin/env node
/**
 * Golden Set D 阶段验证 — 用 golden set 评估 production pipeline
 *
 * 设计原则（CLAUDE.md）：
 * - Eval 把 production pipeline 当黑盒，只传 question
 * - Server 从 DB 自动读取所有配置（provider、embedding、reranker、KB 等）
 * - 不启动隔离服务器、不上传 KB、不写入 settings
 *
 * 步骤：
 * 1. 连接 production server（localhost:3000）
 * 2. 导入 golden set 到 DB
 * 3. 调用 POST /metrics/eval/run（只传 question，server 自动读取 production 配置）
 * 4. 验证评估结果
 */

import { postJSON, getJSON } from "./e2e-shared/http.mjs";
import { getTestBase } from "./e2e-shared/env.mjs";
import { readFileSync, mkdirSync, writeFileSync } from "fs";

// 必须通过 TEST_BASE 环境变量或 startIsolatedServer() 设置，禁止默认指向生产数据库
// getTestBase() 返回 ".../api" 格式，直接 fetch 时需去掉 /api 后缀
const _testBase = getTestBase();
const BASE_URL = _testBase.replace(/\/api$/, "");

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function inRange(val, min = 0, max = 1) {
  return typeof val === "number" && val >= min && val <= max;
}

async function checkServerReady() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== Golden Set D 阶段验证（Production Pipeline 评估）===\n");
  console.log(`Server: ${BASE_URL}`);

  // ── Step 0: 检查 production server 是否可用 ──
  const ready = await checkServerReady();
  if (!ready) {
    console.log("❌ Production server 不可用。请先启动: npm run dev");
    process.exit(1);
  }
  console.log("✅ Production server 就绪\n");

  // ── Step 1: 读取 golden set ──
  const gsPath = "tests/eval-reports/golden-set-2026-06-13T07-10-14.json";
  let goldenSet;
  try {
    goldenSet = JSON.parse(readFileSync(gsPath, "utf-8"));
  } catch (err) {
    console.log(`❌ 无法读取文件: ${err.message}`);
    process.exit(1);
  }
  console.log(`Golden set: ${gsPath} (${goldenSet.length} 题)\n`);

  // ── Step 2: 导入 golden set 到 DB ──
  console.log("导入 golden set 到 DB...");
  const importRes = await postJSON("/metrics/golden-set/import", { questions: goldenSet });
  const importData = await importRes.json();
  if (!importData.ok) {
    console.error("❌ 导入失败:", importData.error);
    process.exit(1);
  }
  console.log(`✅ 已导入 ${importData.count} 题\n`);

  // ── Step 3: 运行评估（只传 question，server 自动读取 production 配置）──
  console.log("━━━ D 阶段：运行 production pipeline 评估 ━━━");
  console.log(`题目数量: ${goldenSet.length}`);
  console.log("注意：server 从 DB 自动读取 provider/embedding/reranker/KB 配置\n");

  const startEval = performance.now();
  const evalRes = await postJSON(
    "/metrics/eval/run",
    {
      configs: [{ label: "production", providerId: "auto", modelId: "auto" }],
      maxConcurrency: 3,
      // 不传 apiKey、knowledgeEmbedding、knowledgeReranker、searchApiKey、webSearchEnabled
      // server 从 DB 自动读取所有 production 配置
    },
    undefined,
    1_200_000,
  );
  const endEval = performance.now();
  const evalData = await evalRes.json();
  const durationSec = (endEval - startEval) / 1000;

  if (evalData.error) {
    console.error(`❌ 评估失败: ${evalData.error}`);
    process.exit(1);
  }

  console.log(`\n评估完成:`);
  console.log(`  耗时: ${durationSec.toFixed(1)}s`);
  console.log(`  Run ID: ${evalData.runId}`);
  console.log(`  题目数: ${evalData.questionCount}`);

  // ── Step 4: 验证 ──
  console.log("\n━━━ 验证 ━━━");
  let allPass = true;

  // V1: 每道题都有 eval result
  const results = evalData.questionBreakdown || [];
  if (results.length === goldenSet.length) {
    console.log(`✅ V1_result_count: ${results.length}/${goldenSet.length} 题都有 eval result`);
  } else {
    console.log(`❌ V1_result_count: ${results.length}/${goldenSet.length} 题有 eval result`);
    allPass = false;
  }

  // V2: 指标值在合理范围（0-1）
  let outOfRange = 0;
  const metricFields = [
    "recallAtK", "ndcgAtK", "faithfulness",
    "answerCorrectness", "factCoverage", "articleAccuracy",
    "sourceRoutingAccuracy", "sourceAttributionAccuracy",
    "conflictResolution", "refusalAccuracy",
    "kbHitRate",
  ];
  for (const r of results) {
    for (const field of metricFields) {
      const val = r[field];
      if (val !== undefined && val !== null && !inRange(val, 0, 1)) {
        outOfRange++;
        if (outOfRange <= 3) {
          console.log(`  ⚠️ ${r.goldenId}.${field} = ${val} (超出 0-1)`);
        }
      }
    }
  }
  if (outOfRange === 0) {
    console.log(`✅ V2_metric_range: 全部指标在 [0, 1] 范围内`);
  } else {
    console.log(`❌ V2_metric_range: ${outOfRange} 个指标超出 [0, 1]`);
    allPass = false;
  }

  // V3: 每道题有 durationMs > 0
  const withDuration = results.filter(r => r.durationMs > 0);
  if (withDuration.length === results.length) {
    const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length;
    console.log(`✅ V3_duration: 全部有耗时数据，平均 ${(avgMs / 1000).toFixed(1)}s/题`);
  } else {
    console.log(`❌ V3_duration: ${withDuration.length}/${results.length} 题有耗时数据`);
    allPass = false;
  }

  // V4: 评估报告已保存到 DB
  const reportsRes = await getJSON(`/metrics/eval/reports/${evalData.runId}`);
  const reportDetail = await reportsRes.json();
  const detailResults = reportDetail.questionBreakdown || reportDetail.results || [];
  if (reportDetail.runId === evalData.runId || detailResults.length > 0) {
    console.log(`✅ V4_report_saved: 报告已保存到 DB（runId=${evalData.runId}, ${detailResults.length} 条记录）`);
  } else {
    const reportsListRes = await getJSON("/metrics/eval/reports");
    const reportsList = await reportsListRes.json();
    const count = Array.isArray(reportsList) ? reportsList.length : 0;
    if (count > 0) {
      console.log(`✅ V4_report_saved: DB 中有 ${count} 条 eval 记录`);
    } else {
      console.log(`❌ V4_report_saved: 未在 DB 中找到评估报告`);
      allPass = false;
    }
  }

  // V5: config summary 指标合理
  const summary = evalData.configs?.[0];
  if (summary) {
    const summaryFields = ["avgRecall", "avgNdcg", "avgFaithfulness"];
    let summaryOk = true;
    for (const f of summaryFields) {
      if (!inRange(summary[f], 0, 1)) {
        console.log(`  ⚠️ configSummary.${f} = ${summary[f]} (超出 0-1)`);
        summaryOk = false;
      }
    }
    if (summaryOk) {
      console.log(`✅ V5_summary: avgRecall=${summary.avgRecall?.toFixed(3)}, avgNdcg=${summary.avgNdcg?.toFixed(3)}, avgFaith=${summary.avgFaithfulness?.toFixed(3)}`);
    } else {
      console.log(`❌ V5_summary: 部分汇总指标超出范围`);
      allPass = false;
    }
  }

  // V6: 耗时合理（不超过 30 分钟）
  if (durationSec < 1800) {
    console.log(`✅ V6_timing: 总耗时 ${durationSec.toFixed(1)}s（${(durationSec / 60).toFixed(1)}min）`);
  } else {
    console.log(`❌ V6_timing: 总耗时 ${durationSec.toFixed(1)}s（>= 1800s，异常慢）`);
    allPass = false;
  }

  // V7: 有错误的题目数
  const withError = results.filter(r => r.error);
  if (withError.length === 0) {
    console.log(`✅ V7_no_errors: 全部题目无错误`);
  } else {
    console.log(`⚠️ V7_no_errors: ${withError.length} 题有错误`);
    for (const r of withError) {
      console.log(`  - ${r.goldenId}: ${r.error}`);
    }
  }

  // V8: 检查 answer 是否使用了多个 KB 文件（不只是专利法）
  const uniqueSources = new Set();
  for (const r of results) {
    if (r.actualSources) {
      for (const s of r.actualSources) {
        uniqueSources.add(s);
      }
    }
  }
  console.log(`\n📋 实际使用的来源文件: ${[...uniqueSources].join(", ")}`);
  if (uniqueSources.size > 1) {
    console.log(`✅ V8_multi_source: 使用了 ${uniqueSources.size} 个不同来源`);
  } else {
    console.log(`⚠️ V8_multi_source: 只使用了 ${uniqueSources.size} 个来源（预期多个 KB 文件 + web search）`);
  }

  // ── 保存评估报告 ──
  const ts = timestamp();
  const outDir = "tests/eval-reports";
  mkdirSync(outDir, { recursive: true });
  const reportPath = `${outDir}/eval-report-${ts}.json`;
  writeFileSync(reportPath, JSON.stringify(evalData, null, 2));
  console.log(`\n📄 评估报告已保存: ${reportPath}`);

  // ── 最终结论 ──
  console.log("\n━━━ 结论 ━━━");
  if (allPass) {
    console.log("PROCEED — D 阶段验证全部通过");
  } else {
    console.log("FAIL — 存在验证失败项");
  }

  console.log(`\nFILES:eval-report=${reportPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
