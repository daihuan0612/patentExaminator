#!/usr/bin/env node
/**
 * RAG 知识库检索质量评估脚本
 *
 * 评估指标：
 * - Recall@5: 前 5 个结果中包含期望来源的比例
 * - MRR: 期望来源的平均排名倒数
 * - Citation Accuracy: 引用的法条是否正确
 *
 * 用法：node tests/evaluation/rag-eval.mjs [--api-key KEY]
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getTestBase } from "../e2e-shared/env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(join(__dirname, "rag-eval-dataset.json"), "utf-8"));

// getTestBase() 返回 ".../api" 格式，本脚本 fetch 时手动拼 /api，需去掉后缀
const API_BASE = process.env.API_BASE || getTestBase().replace(/\/api$/, "");
const API_KEY = process.argv.find((a) => a.startsWith("--api-key="))?.split("=")[1] || process.env.GEMINI_KEY || "";

async function searchKnowledge(query) {
  const res = await fetch(`${API_BASE}/api/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      topK: 5,
      apiKey: API_KEY,
    }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

function calculateRecallAtK(results, expectedSources, k = 5) {
  const topK = results.slice(0, k);
  const found = expectedSources.some((source) =>
    topK.some((r) => r.source?.includes(source) || r.text?.includes(source))
  );
  return found ? 1 : 0;
}

function calculateMRR(results, expectedSources) {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (expectedSources.some((source) => r.source?.includes(source) || r.text?.includes(source))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function calculateArticleAccuracy(results, expectedArticles) {
  if (expectedArticles.length === 0) return 1; // 无期望法条，视为通过
  const allText = results.map((r) => r.text || "").join(" ");
  const found = expectedArticles.filter((art) => allText.includes(art));
  return found.length / expectedArticles.length;
}

async function main() {
  console.log("=== RAG 知识库检索质量评估 ===\n");
  console.log(`数据集: ${dataset.questions.length} 个问题`);
  console.log(`API: ${API_BASE}\n`);

  let totalRecall = 0;
  let totalMRR = 0;
  let totalArticleAccuracy = 0;
  let successCount = 0;
  let failCount = 0;

  for (const q of dataset.questions) {
    try {
      const results = await searchKnowledge(q.query);

      const recall = calculateRecallAtK(results, q.expectedSources);
      const mrr = calculateMRR(results, q.expectedSources);
      const articleAcc = calculateArticleAccuracy(results, q.expectedArticles);

      totalRecall += recall;
      totalMRR += mrr;
      totalArticleAccuracy += articleAcc;
      successCount++;

      const status = recall > 0 ? "✅" : "❌";
      console.log(`${status} ${q.id}: "${q.query}"`);
      console.log(`   Recall@5=${recall.toFixed(2)} MRR=${mrr.toFixed(2)} ArticleAcc=${articleAcc.toFixed(2)}`);
      if (recall === 0) {
        console.log(`   期望来源: ${q.expectedSources.join(", ")}`);
        console.log(`   实际结果: ${results.slice(0, 3).map((r) => r.source || "unknown").join(", ")}`);
      }
    } catch (err) {
      failCount++;
      console.log(`⚠️  ${q.id}: "${q.query}" — ${err.message}`);
    }
  }

  console.log("\n=== 汇总 ===");
  console.log(`成功: ${successCount}/${dataset.questions.length}`);
  console.log(`失败: ${failCount}/${dataset.questions.length}`);
  if (successCount > 0) {
    console.log(`Recall@5: ${(totalRecall / successCount).toFixed(3)}`);
    console.log(`MRR: ${(totalMRR / successCount).toFixed(3)}`);
    console.log(`Citation Accuracy: ${(totalArticleAccuracy / successCount).toFixed(3)}`);
  }
}

main().catch(console.error);
