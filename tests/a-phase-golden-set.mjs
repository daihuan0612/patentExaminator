#!/usr/bin/env node
/**
 * A 阶段验证 — 从生产 KB 生成 Golden Set
 *
 * 与 perf-golden-set.mjs 的区别：
 * - 使用 copyProductionDb: true，确保 golden set 从生产 KB 生成
 * - D 阶段测试也用 copyProductionDb: true，chunk ID 一致
 *
 * 步骤：
 * 1. 启动隔离服务器（复制生产 DB，保留真实 settings + KB）
 * 2. A.1 生成 Golden Set（从生产 KB 采样）
 * 3. A.2 Relevance Grading（2-judge 打分）
 * 4. B 质量评估
 * 5. C 清理不合格题目
 * 6. 导出 golden-set-{ts}.json
 */

import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { postJSON, getJSON } from "./e2e-shared/http.mjs";
import { startIsolatedServer } from "./e2e-shared/server-lifecycle.mjs";
import { mkdirSync, writeFileSync } from "fs";

loadEnvFile();

let BASE;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function main() {
  const ts = timestamp();
  const logLines = [];
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(msg);
    logLines.push(line);
  }

  log("=== A 阶段：从生产 KB 生成 Golden Set ===\n");

  // ── Step 1: 启动隔离服务器（复制生产 DB） ──
  log("Step 1: 启动隔离服务器（复制生产 DB）...");
  const server = await startIsolatedServer({ copyProductionDb: true });
  BASE = server.baseUrl;
  log(`✅ 隔离服务器就绪: ${BASE}`);

  // ── Step 1b: 检查生产 DB 中的 KB 和 settings ──
  log("\nStep 1b: 检查生产 DB...");
  try {
    const settingsRes = await getJSON("/data/settings/app", BASE);
    const settingsResp = await settingsRes.json();
    const settingsData = settingsResp.record || settingsResp;
    if (settingsData.providers) {
      for (const p of settingsData.providers) {
        log(`  provider: ${p.providerId}, enabled: ${p.enabled}, model: ${p.defaultModelId}`);
      }
    }
    log(`  knowledgeEnabled: ${settingsData.knowledge?.enabled}`);
  } catch (e) {
    log(`  ⚠️ 读取 settings 失败: ${e.message}`);
  }

  // ── Step 2: A.1 生成 Golden Set ──
  log("\n━━━ Step 2: A.1 生成 Golden Set ━━━");

  // 从 .env 读取 API key（与 D 阶段一致）
  const mimoKey = getApiKey("mimo");
  const volcengineKey = getApiKey("volcengine");
  const tavilyKey = getApiKey("tavily");

  if (!mimoKey && !volcengineKey) {
    log("❌ 没有找到任何 LLM API key（mimo/volcengine），无法生成");
    process.exit(1);
  }

  const providerConfigs = [];
  if (mimoKey) providerConfigs.push({ providerId: "mimo", model: "mimo-v2.5", apiKey: mimoKey, label: "MiMo" });
  if (volcengineKey) {
    providerConfigs.push({ providerId: "volcengine", model: "deepseek-v3-2-251201", apiKey: volcengineKey, label: "DeepSeek" });
    providerConfigs.push({ providerId: "volcengine", model: "doubao-seed-2-0-pro-260215", apiKey: volcengineKey, label: "doubao-seed" });
  }

  log(`Providers: ${providerConfigs.map(p => p.label).join(", ")}`);
  log(`Tavily: ${tavilyKey ? "已配置" : "未配置（web 题型将跳过）"}`);
  log(`每个 provider 生成 7 题\n`);

  const startGen = performance.now();
  const resGen = await postJSON(
    "/metrics/golden-set/generate",
    { providerConfigs, ...(tavilyKey && { searchApiKey: tavilyKey }) },
    BASE,
    600_000,
  );
  const endGen = performance.now();
  const dataGen = await resGen.json();
  const durationGen = (endGen - startGen) / 1000;

  if (dataGen.error) {
    log(`❌ 生成失败: ${dataGen.error}`);
    process.exit(1);
  }
  log(`✅ A.1 完成: ${dataGen.count} 题, 耗时 ${durationGen.toFixed(1)}s`);

  if (dataGen.questions) {
    const providerBreakdown = {};
    for (const q of dataGen.questions) {
      const provider = q.generatedBy || q.generated_by || "unknown";
      providerBreakdown[provider] = (providerBreakdown[provider] || 0) + 1;
    }
    log(`分布: ${JSON.stringify(providerBreakdown)}`);

    for (let i = 0; i < dataGen.questions.length; i++) {
      const q = dataGen.questions[i];
      const provider = q.generatedBy || q.generated_by || "unknown";
      log(`  Q${i + 1} [${provider}] ${q.category}/${q.sourceType}: ${q.query.slice(0, 80)}...`);
    }
  }

  // ── Step 3: A.2 Relevance Grading ──
  log("\n━━━ Step 3: A.2 Relevance Grading（2-judge）━━━");
  const judgeApiKeys = {};
  if (mimoKey) judgeApiKeys.mimo = mimoKey;
  if (volcengineKey) judgeApiKeys.volcengine = volcengineKey;

  if (Object.keys(judgeApiKeys).length > 0 && dataGen.count > 0) {
    const startGrade = performance.now();
    const resGrade = await postJSON(
      "/metrics/golden-set/grade",
      { judgeApiKeys },
      BASE,
      600_000,
    );
    const endGrade = performance.now();
    const dataGrade = await resGrade.json();
    const durationGrade = (endGrade - startGrade) / 1000;

    if (dataGrade.error) {
      log(`❌ Grading 失败: ${dataGrade.error}`);
    } else {
      log(`✅ A.2 完成: ${dataGrade.graded || 0} 题已 grading, 耗时 ${durationGrade.toFixed(1)}s`);

      if (dataGrade.results) {
        const gradeDistribution = { 0: 0, 1: 0, 2: 0, 3: 0 };
        let totalCandidates = 0;
        for (const r of dataGrade.results) {
          for (const g of (r.grading || [])) {
            gradeDistribution[g.grade] = (gradeDistribution[g.grade] || 0) + 1;
            totalCandidates++;
          }
        }
        log(`候选总数: ${totalCandidates}`);
        log(`Grade 分布: ${JSON.stringify(gradeDistribution)}`);
      }
    }
  } else {
    log("⏭️ 跳过 grading（无 judge API key 或无题目）");
  }

  // ── Step 4: B 质量评估 ──
  log("\n━━━ Step 4: B 质量评估 ━━━");
  const resQuality = await getJSON("/metrics/golden-set/quality", BASE);
  const dataQuality = await resQuality.json();
  log(`通过: ${dataQuality.passed ? "✅" : "❌"}`);
  log(`建议: ${dataQuality.recommendation}`);
  if (dataQuality.checks) {
    for (const [name, check] of Object.entries(dataQuality.checks)) {
      log(`  ${check.passed ? "✅" : "❌"} ${name}: ${check.detail}`);
    }
  }

  // ── Step 5: C 清理不合格题目 ──
  log("\n━━━ Step 5: C 清理不合格题目 ━━━");
  const resClean = await postJSON("/metrics/golden-set/clean", {}, BASE);
  const dataClean = await resClean.json();
  log(`删除: ${dataClean.deleted?.length || 0} 题`);
  log(`保留: ${dataClean.kept || 0} 题`);
  if (dataClean.deleted?.length > 0) {
    log(`被删题目: ${dataClean.deleted.join(", ")}`);
  }

  // ── Step 6: 导出 Golden Set JSON ──
  const outDir = "tests/eval-reports";
  mkdirSync(outDir, { recursive: true });
  const cleanPath = `${outDir}/golden-set-${ts}.json`;
  if (dataClean.questions) {
    writeFileSync(cleanPath, JSON.stringify(dataClean.questions, null, 2), "utf-8");
    log(`\n✅ 清理后 golden set 已保存: ${cleanPath}`);
  }

  // 也保存原始版本（含 grading，调试用）
  const rawPath = `${outDir}/golden-set-raw-${ts}.json`;
  try {
    const resExport = await getJSON("/metrics/golden-set", BASE);
    const dataExport = await resExport.json();
    if (dataExport.questions) {
      writeFileSync(rawPath, JSON.stringify(dataExport.questions, null, 2), "utf-8");
      log(`✅ 原始 golden set 已保存: ${rawPath}`);
    }
  } catch (e) {
    log(`⚠️ 原始 golden set 导出失败: ${e.message}`);
  }

  // 保存质量报告
  const qualityPath = `${outDir}/quality-report-${ts}.json`;
  writeFileSync(qualityPath, JSON.stringify(dataQuality, null, 2), "utf-8");
  log(`✅ 质量报告已保存: ${qualityPath}`);

  // ── 保存测试日志 ──
  const logDir = "tests/logs";
  mkdirSync(logDir, { recursive: true });
  const logPath = `${logDir}/a-phase-log-${ts}.log`;
  writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");
  log(`\n📄 测试日志: ${logPath}`);

  // ── 最终结论 ──
  log("\n━━━ 结论 ━━━");
  const allPass = dataGen.count > 0 && dataQuality.passed && (dataClean.kept || 0) > 0;
  if (allPass) {
    log("PROCEED — A 阶段验证全部通过");
    log(`\n下一步: 用生成的 golden set 运行 D 阶段测试:`);
    log(`  GOLDEN_SET=${cleanPath} QUESTION_COUNT=1 node tests/d-phase-eval.mjs`);
  } else {
    log("FAIL — 存在验证失败项");
  }

  log(`\nFILES:golden-set=${cleanPath}`);
  log(`FILES:raw-golden-set=${rawPath}`);
  log(`FILES:quality-report=${qualityPath}`);
  log(`FILES:test-log=${logPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
