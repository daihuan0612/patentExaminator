#!/usr/bin/env node
/**
 * 修复 golden set 的 chunk ID：用文本匹配替换为生产 KB 的 chunk ID
 *
 * 原因：perf-golden-set.mjs 在隔离服务器重新上传文件，产生了不同的 chunk ID
 * 修复：按文本内容匹配，替换为生产 KB 的 chunk ID
 *
 * 0 token，不调用 LLM
 */

import { readFileSync, writeFileSync } from "fs";
import Database from "better-sqlite3";

const KB_DB = "server/data/knowledge.db";
const GOLDEN_SET = process.argv[2] || "tests/eval-reports/golden-set-2026-06-13T07-10-14.json";

function main() {
  console.log(`\n=== 修复 Golden Set Chunk ID ===\n`);
  console.log(`生产 KB: ${KB_DB}`);
  console.log(`Golden Set: ${GOLDEN_SET}\n`);

  // 1. 从生产 KB 加载所有 chunk（text → chunk ID）
  const db = new Database(KB_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT c.id, c.source_id, c.text, s.name as source_name
    FROM kb_chunks c
    JOIN kb_sources s ON c.source_id = s.id
  `).all();
  db.close();

  console.log(`生产 KB: ${rows.length} chunks`);

  // 建立 text → chunk 的映射（去空白后匹配，容忍格式差异）
  const textToChunk = new Map();
  for (const row of rows) {
    const normalizedText = row.text.replace(/[\s　]+/g, "").trim();
    if (normalizedText.length > 0) {
      textToChunk.set(normalizedText, {
        chunkId: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
      });
    }
  }
  console.log(`文本映射: ${textToChunk.size} 条\n`);

  // 2. 加载 golden set
  const goldenSet = JSON.parse(readFileSync(GOLDEN_SET, "utf-8"));
  console.log(`Golden Set: ${goldenSet.length} 题\n`);

  // 3. 替换 chunk ID
  let totalGraded = 0;
  let matched = 0;
  let unmatched = 0;

  for (const question of goldenSet) {
    if (!question.relevanceGrading || question.relevanceGrading.length === 0) continue;

    for (const grade of question.relevanceGrading) {
      totalGraded++;

      // 从生产 KB 中查找文本匹配的 chunk
      // golden set 的 grading 没有存 chunk text，但有 docId（source 文件名）
      // 我们需要通过 docId + chunk index 来匹配
      // 实际上，更可靠的方式是：先按 docId（文件名）过滤，再按 chunk 在文件中的序号匹配

      // 尝试方案：直接遍历同文件名的所有 chunk，按序号匹配
      // chunkId 格式：ks-{ts}-{rand}-c{index}
      const oldChunkId = grade.chunkId;
      const oldIndex = oldChunkId.match(/-c(\d+)$/)?.[1];
      const oldDocId = grade.docId; // 文件名，如 "专利法_2020修正.txt"

      if (oldIndex === undefined) {
        console.log(`  ⚠️ 无法解析 chunk index: ${oldChunkId}`);
        unmatched++;
        continue;
      }

      // 在生产 KB 中找同文件名、同序号的 chunk
      const matchingRow = rows.find(r =>
        r.source_name === oldDocId && r.id.endsWith(`-c${oldIndex}`)
      );

      if (matchingRow) {
        const oldId = grade.chunkId;
        grade.chunkId = matchingRow.id;
        matched++;
        if (matched <= 5) {
          console.log(`  ✅ ${oldId} → ${matchingRow.id}`);
        }
      } else {
        console.log(`  ❌ 未匹配: ${grade.chunkId} (docId=${oldDocId}, index=${oldIndex})`);
        unmatched++;
      }
    }
  }

  console.log(`\n匹配结果: ${matched}/${totalGraded} 成功, ${unmatched} 失败`);

  if (matched === 0) {
    console.log("\n❌ 没有任何匹配，放弃修改");
    process.exit(1);
  }

  // 4. 保存修复后的 golden set
  const outPath = GOLDEN_SET.replace(".json", "-fixed.json");
  writeFileSync(outPath, JSON.stringify(goldenSet, null, 2), "utf-8");
  console.log(`\n✅ 修复后 golden set 已保存: ${outPath}`);
  console.log(`\n下一步: GOLDEN_SET=${outPath} QUESTION_COUNT=1 node tests/d-phase-eval.mjs`);
}

main();
