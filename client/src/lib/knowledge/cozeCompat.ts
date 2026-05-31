/**
 * Coze 迁移兼容层 — 将 RAG 检索结果适配 Coze.cn Skill 架构
 *
 * Coze Skill 的特点：
 * 1. 单条 user message（无 system role）
 * 2. JSON 输出约束
 * 3. 变量通过 {{variable}} 传递
 *
 * 本模块将 RAG 检索结果转换为 Coze Skill 可用的格式。
 */

import type { KnowledgeSearchResult } from "@shared/types/knowledge";

/** 将检索结果转换为 Coze Skill 变量格式 */
export function formatForCozeSkill(
  results: KnowledgeSearchResult[],
  skillName: string
): Record<string, string> {
  const vars: Record<string, string> = {};

  if (results.length === 0) return vars;

  // 将检索结果格式化为单个文本变量
  const parts: string[] = [];
  for (const result of results) {
    const { chunk, score } = result;
    const source = chunk.metadata.sectionId ?? chunk.metadata.articleId ?? chunk.metadata.fileName;
    parts.push(`【来源: ${source} | 相似度: ${score.toFixed(2)}】\n${chunk.text}`);
  }

  vars[`${skillName}_knowledge`] = parts.join("\n\n---\n\n");
  vars[`${skillName}_chunk_count`] = String(results.length);

  return vars;
}

/** 将 Coze Skill 的输出转换为 KnowledgeSearchResult 格式 */
export function parseCozeSkillOutput(
  output: string
): { answer: string; citations: string[] } {
  try {
    const parsed = JSON.parse(output);
    return {
      answer: parsed.answer ?? output,
      citations: parsed.citations ?? [],
    };
  } catch {
    return { answer: output, citations: [] };
  }
}

/** Coze Skill 的 Prompt 注入模板（替代 system prompt） */
export function buildCozePrompt(
  agentType: string,
  knowledgeText: string,
  userQuery: string
): string {
  const contextMap: Record<string, string> = {
    novelty: "新颖性判断",
    inventive: "创造性三步法判断",
    "opinion-analysis": "审查意见解析",
    "argument-analysis": "答辩理由评估",
    "reexam-draft": "复审意见草稿",
    "claim-chart": "权利要求特征拆解",
    defects: "形式缺陷检查",
  };

  const context = contextMap[agentType] ?? "专利审查";

  return `你是专利复审 AI 助手，当前任务是${context}。

## 参考法规
${knowledgeText}

## 用户输入
${userQuery}

## 输出要求
- 严格基于上述参考法规回答
- 引用法规时标注来源
- 不输出法律结论，所有结论标注"候选/待确认"
- JSON 格式输出`;
}
