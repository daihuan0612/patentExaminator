#!/usr/bin/env node
/**
 * Golden Set 生成性能测试
 * 通过隔离服务器实际测量批量并行 vs 旧串行的耗时
 */

import { loadEnvFile, getApiKey } from "./e2e-shared/env.mjs";
import { postJSON, getJSON } from "./e2e-shared/http.mjs";
import { startIsolatedServer } from "./e2e-shared/server-lifecycle.mjs";
import { uploadKnowledgeFile, SAMPLES_KNOWLEDGE_DIR } from "./e2e-shared/index.mjs";
import { GEMINI_FALLBACK_MODELS } from "./e2e-shared/config.mjs";
import path from "path";

loadEnvFile();

async function main() {
  console.log("=== Golden Set 生成性能测试 ===\n");

  const mimoKey = getApiKey("mimo");
  const geminiKey = getApiKey("gemini");
  const volcengineKey = getApiKey("volcengine");

  if (!mimoKey && !geminiKey && !volcengineKey) {
    console.log("❌ 没有找到任何 API key，跳过");
    process.exit(0);
  }

  // 启动隔离服务器
  console.log("启动隔离服务器...");
  const { baseUrl, cleanup } = await startIsolatedServer();
  process.env.TEST_BASE = baseUrl;
  console.log(`服务器就绪: ${baseUrl}\n`);

  try {
    // 上传知识库文件
    console.log("上传知识库文件...");
    const filePath = path.join(SAMPLES_KNOWLEDGE_DIR, "专利法_2020修正.txt");
    const uploadResult = await uploadKnowledgeFile(filePath);
    if (!uploadResult.ok) {
      console.error("❌ 上传失败:", uploadResult.error);
      process.exit(1);
    }
    console.log("✅ 知识库文件已上传\n");

    // 写入 settings 到隔离 DB（包含 Gemini fallback 链）
    console.log("写入 settings 到隔离 DB...");
    const settingsProviders = [];
    if (mimoKey) settingsProviders.push({ providerId: "mimo", apiKeyRef: mimoKey });
    if (volcengineKey) settingsProviders.push({ providerId: "volcengine", apiKeyRef: volcengineKey });
    if (geminiKey) {
      settingsProviders.push({
        providerId: "gemini",
        apiKeyRef: geminiKey,
        modelFallbacks: [...GEMINI_FALLBACK_MODELS],
        enableModelFallback: true,
      });
    }
    const settingsRes = await postJSON("/sync/upload", {
      stores: { settings: [{ id: "app", data: { providers: settingsProviders } }] },
    });
    const settingsData = await settingsRes.json().catch(() => ({}));
    console.log(`✅ Settings 已写入 (providers=${settingsProviders.length}, gemini fallback=${GEMINI_FALLBACK_MODELS.length} models)\n`);

    // 构建 provider 配置
    const providerConfigs = [];
    if (mimoKey) providerConfigs.push({ providerId: "mimo", model: "mimo-v2.5-pro", apiKey: mimoKey, label: "MiMo" });
    if (volcengineKey) providerConfigs.push({ providerId: "volcengine", model: "deepseek-v4-pro-260425", apiKey: volcengineKey, label: "DeepSeek" });
    if (geminiKey) providerConfigs.push({ providerId: "gemini", model: "gemini-3.5-flash", apiKey: geminiKey, label: "Gemini" });

    console.log(`Providers: ${providerConfigs.map(p => p.label).join(", ")}`);
    console.log(`每个 provider 生成 5 题（减少 API 负担避免超时）\n`);

    // ── 测试：批量并行模式 ──
    console.log("━━━ 测试：批量并行模式（5题/provider）━━━");
    const startFull = performance.now();

    const resFull = await postJSON(
      "/metrics/golden-set/generate",
      { providerConfigs, questionsPerProvider: 5 },
      undefined,
      300_000,
    );

    const endFull = performance.now();
    const dataFull = await resFull.json();
    const durationFull = endFull - startFull;

    console.log(`\n结果: ${dataFull.count} 题`);
    console.log(`耗时: ${(durationFull / 1000).toFixed(1)}s`);
    console.log(`每题平均: ${(durationFull / (dataFull.count || 1)).toFixed(0)}ms`);

    // 打印 golden set 内容
    console.log("\n━━━ 生成的 Golden Set ━━━");
    if (dataFull.questions) {
      const providerBreakdown = {};
      for (const q of dataFull.questions) {
        const provider = q.generatedBy || q.generated_by || "unknown";
        providerBreakdown[provider] = (providerBreakdown[provider] || 0) + 1;
      }
      console.log(`分布: ${JSON.stringify(providerBreakdown)}\n`);

      for (let i = 0; i < dataFull.questions.length; i++) {
        const q = dataFull.questions[i];
        const provider = q.generatedBy || q.generated_by || "unknown";
        console.log(`── Q${i + 1} [${provider}] ${q.category}/${q.difficulty} ──`);
        console.log(`  问题: ${q.query}`);
        console.log(`  预期: ${q.expectedAnswer.slice(0, 120)}...`);
        console.log(`  法条: ${q.expectedArticles?.join(", ") || "无"}`);
        console.log(`  来源: ${q.expectedSources?.join(", ") || "无"}`);
        console.log();
      }
    }

  } finally {
    await cleanup();
    console.log("\n✅ 清理完成");
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
