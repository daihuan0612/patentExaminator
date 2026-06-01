/**
 * 服务端编排器 — B-035: 将 AgentClient 协调逻辑迁移到服务端
 *
 * 职责：
 * 1. 根据 agent 类型构造 prompt
 * 2. 知识库增强
 * 3. 调用 AI Gateway
 * 4. 返回结果
 */
import { logger } from "./logger.js";

// ── 类型定义 ──────────────────────────────────────────

export interface AgentRunRequest {
  agent: string;
  caseId: string;
  request: Record<string, unknown>;
  providerPreference?: string[];
  modelId?: string;
  modelFallbacks?: Record<string, string[]>;
  enableModelFallback?: Record<string, boolean>;
  providerBaseUrls?: Record<string, string>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AgentRunResponse {
  ok: boolean;
  output?: unknown;
  tokenUsage?: { input: number; output: number; total: number };
  attempts?: Array<{ providerId: string; modelId: string; errorCode?: string; duration: number }>;
  error?: { type: string; message: string };
  knowledgeCitations?: Array<{ source: string; score: number; excerpt: string }>;
}

// ── Prompt 构造器 ──────────────────────────────────────

function buildClaimChartPrompt(request: Record<string, unknown>): string {
  const claimNumber = request.claimNumber as number ?? 1;
  const claimText = request.claimText as string ?? "";
  const specificationText = request.specificationText as string ?? "";
  const specExcerpt = specificationText.length > 8000 ? specificationText.slice(0, 8000) : specificationText;

  return [
    `你是一位资深专利审查员助理，任务是对权利要求 ${claimNumber} 进行技术特征拆解（Claim Chart）。`,
    ``,
    `约束：`,
    `- 只能基于给定的权利要求文本与说明书片段；不得编造段落号或引用。`,
    `- 每个技术特征必须给出可映射到说明书段落号的 specificationCitations；若无法定位，citationStatus 必须为 "needs-review"。`,
    `- 不得输出新颖性/创造性等法律结论。`,
    `- 严格按下方 JSON 格式输出，不要输出 markdown 代码块或任何解释性文字。`,
    ``,
    `权利要求 ${claimNumber} 文本：`,
    claimText,
    ``,
    `说明书片段（含段落号，如有）：`,
    specExcerpt || "（未提供说明书片段）",
    ``,
    `请严格输出以下 JSON 格式（字段名必须完全一致，使用双引号）：`,
    `{`,
    `  "claimNumber": ${claimNumber},`,
    `  "features": [`,
    `    {`,
    `      "featureCode": "A",`,
    `      "description": "技术特征描述",`,
    `      "specificationCitations": [`,
    `        { "label": "[0001]", "paragraph": "0001", "quote": "说明书原文摘录", "confidence": "high" }`,
    `      ],`,
    `      "citationStatus": "confirmed"`,
    `    }`,
    `  ],`,
    `  "warnings": [`,
    `    { "type": "other", "message": "可选警告说明" }`,
    `  ],`,
    `  "pendingSearchQuestions": ["待检索问题，最多5条"],`,
    `  "legalCaution": "以上为候选事实整理，不构成法律结论。"`,
    `}`,
    ``,
    `注意：`,
    `- featureCode 使用大写字母 A、B、C…（从 A 起连续编号）`,
    `- features 至少 1 项；citationStatus 只能是 confirmed / needs-review / not-found`,
    `- specificationCitations 中 confidence 只能是 high / medium / low`,
    `- warnings 可为空数组 []；pendingSearchQuestions 最多 5 条`
  ].join("\n");
}

function buildNoveltyPrompt(request: Record<string, unknown>): string {
  const features = request.features as Array<{ featureCode: string; description: string }> ?? [];
  const referenceText = request.referenceText as string ?? "";
  const referenceId = request.referenceId as string ?? "";
  const claimNumber = request.claimNumber as number ?? 1;
  const caseId = request.caseId as string ?? "";
  const specExcerpt = referenceText.length > 8000 ? referenceText.slice(0, 8000) : referenceText;

  const parts = [
    `你是一名专利复审辅助系统，负责在复审阶段逐特征重新评估新颖性对照。`,
    ``,
    `## 公开状态四档语义`,
    `- clearly-disclosed：对比文件明确公开了该技术特征`,
    `- possibly-disclosed：对比文件可能公开了该技术特征，但需审查员确认`,
    `- not-found：在对比文件中未找到该技术特征的公开内容`,
    `- not-applicable：该特征不适用于本次对照`,
    ``,
    `## 输入数据`,
    `案件 ID: ${caseId}`,
    `权利要求号: ${claimNumber}`,
    `技术特征:`,
    ...features.map((f) => `  ${f.featureCode}: ${f.description}`),
    ``,
    `对比文件 ID: ${referenceId}`,
    `对比文件内容:`,
    specExcerpt,
    ``,
    `## 输出要求`,
    `严格按以下 JSON 格式输出：`,
    `{`,
    `  "referenceId": "${referenceId}",`,
    `  "claimNumber": ${claimNumber},`,
    `  "rows": [`,
    `    { "featureCode": "A", "disclosureStatus": "clearly-disclosed|possibly-disclosed|not-found|not-applicable", "citations": [{ "label": "[0005]", "paragraph": "0005", "quote": "引用原文", "confidence": "high|medium|low" }], "mismatchNotes": "差异说明" }`,
    `  ],`,
    `  "differenceFeatureCodes": ["B", "C"],`,
    `  "pendingSearchQuestions": ["待检索问题"],`,
    `  "legalCaution": "以上为候选事实整理，不构成法律结论。"`,
    `}`
  ];
  return parts.join("\n");
}

// ── 知识库增强 ──────────────────────────────────────────

async function enhanceWithKnowledge(
  prompt: string,
  query: string,
  agentType: string
): Promise<{ prompt: string; citations: Array<{ source: string; score: number; excerpt: string }> }> {
  try {
    // 使用服务端混合检索（直接调用内部函数，避免 HTTP 往返）
    const { hybridSearch } = await import("./hybridSearch.js");
    const { getAllChunks } = await import("./knowledgeDb.js");

    const allChunks = getAllChunks();

    if (allChunks.length === 0) {
      return { prompt, citations: [] };
    }

    const chunkMap = new Map(allChunks.map((c) => [c.id, c]));

    // 纯 BM25 检索（orchestrator 内部不配置 embedding）
    const scores: Array<{ chunkId: string; score: number }> = [];
    const hybridScores = hybridSearch(query, scores, 15);
    const topResults = hybridScores.slice(0, 5);

    if (topResults.length === 0) {
      return { prompt, citations: [] };
    }

    const contextPrefix = getAgentContext(agentType);
    const parts = [prompt, "", contextPrefix, ""];

    const citations: Array<{ source: string; score: number; excerpt: string }> = [];
    for (const result of topResults) {
      const chunk = chunkMap.get(result.chunkId);
      if (!chunk) continue;
      const metadata = JSON.parse(chunk.metadata) as Record<string, unknown>;
      const source = (metadata.fileName as string) ?? "unknown";
      parts.push(`> 【来源：${source} · 相似度: ${result.score.toFixed(2)}】`);
      for (const line of chunk.text.split("\n").slice(0, 10)) {
        parts.push(`> ${line}`);
      }
      parts.push("");
      citations.push({ source, score: result.score, excerpt: chunk.text.slice(0, 100) });
    }

    return { prompt: parts.join("\n"), citations };
  } catch (err) {
    logger.warn(`Knowledge enhancement failed: ${err}`);
    return { prompt, citations: [] };
  }
}

function getAgentContext(agentType: string): string {
  switch (agentType) {
    case "novelty": return "以下法规段落与新颖性判断相关，请参考：";
    case "inventive": return "以下法规段落与创造性判断相关，请参考：";
    case "claim-chart": return "以下法规段落与权利要求解释相关，请参考：";
    default: return "以下段落与当前分析内容相关，请参考：";
  }
}

// ── 编排器主函数 ──────────────────────────────────────────

/** 服务端编排入口：构造 prompt → 知识库增强 → 调用 AI */
export async function runAgent(req: AgentRunRequest): Promise<AgentRunResponse> {
  try {
    // 1. 构造 prompt
    let prompt: string;
    switch (req.agent) {
      case "claim-chart":
        prompt = buildClaimChartPrompt(req.request);
        break;
      case "novelty":
        prompt = buildNoveltyPrompt(req.request);
        break;
      default:
        return { ok: false, error: { type: "unsupported", message: `Agent ${req.agent} not yet migrated to server orchestrator` } };
    }

    // 2. 知识库增强
    const query = extractQuery(req.agent, req.request);
    const { prompt: enhancedPrompt, citations } = await enhanceWithKnowledge(prompt, query, req.agent);

    // 3. 调用内部 AI Gateway
    const aiResponse = await callInternalGateway({
      agent: req.agent,
      prompt: enhancedPrompt,
      caseId: req.caseId,
      providerPreference: req.providerPreference,
      modelId: req.modelId,
      modelFallbacks: req.modelFallbacks,
      enableModelFallback: req.enableModelFallback,
      providerBaseUrls: req.providerBaseUrls,
      maxTokens: req.maxTokens,
      signal: req.signal,
    });

    return {
      ok: true,
      output: aiResponse.output,
      tokenUsage: aiResponse.tokenUsage,
      attempts: aiResponse.attempts,
      knowledgeCitations: citations,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Orchestrator error: ${message}`);
    return { ok: false, error: { type: "orchestrator", message } };
  }
}

function extractQuery(agent: string, request: Record<string, unknown>): string {
  switch (agent) {
    case "claim-chart":
      return (request.claims as Array<{ rawText: string }> ?? []).map((c) => c.rawText).join(" ") ?? "";
    case "novelty":
      return (request.features as Array<{ description: string }> ?? []).map((f) => f.description).join(" ") ?? "";
    default:
      return "";
  }
}

interface InternalGatewayRequest {
  agent: string;
  prompt: string;
  caseId: string;
  providerPreference?: string[];
  modelId?: string;
  modelFallbacks?: Record<string, string[]>;
  enableModelFallback?: Record<string, boolean>;
  providerBaseUrls?: Record<string, string>;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface InternalGatewayResponse {
  output: unknown;
  tokenUsage?: { input: number; output: number; total: number };
  attempts?: Array<{ providerId: string; modelId: string; errorCode?: string; duration: number }>;
}

async function callInternalGateway(req: InternalGatewayRequest): Promise<InternalGatewayResponse> {
  const { registry } = await import("../providers/registry.js");
  const { getApiKey } = await import("../security/keyStore.js");

  // 构建 provider → apiKey 映射
  const providerApiKeys: Record<string, string> = {};
  for (const pid of req.providerPreference ?? []) {
    const key = getApiKey(pid);
    if (key) providerApiKeys[pid] = key;
  }

  const providerOrder = (req.providerPreference ?? []) as Array<"kimi" | "glm" | "minimax" | "mimo" | "deepseek" | "qwen" | "gemini">;

  const result = await registry.runWithFallback({
    agent: req.agent,
    providerOrder,
    modelId: req.modelId ?? "",
    prompt: req.prompt,
    apiKeys: providerApiKeys,
    providerApiKeys,
    modelFallbacks: req.modelFallbacks as Record<"kimi" | "glm" | "minimax" | "mimo" | "deepseek" | "qwen" | "gemini", string[]> | undefined,
    enableModelFallback: req.enableModelFallback as Record<"kimi" | "glm" | "minimax" | "mimo" | "deepseek" | "qwen" | "gemini", boolean> | undefined,
    providerBaseUrls: req.providerBaseUrls as Record<"kimi" | "glm" | "minimax" | "mimo" | "deepseek" | "qwen" | "gemini", string> | undefined,
    maxTokens: req.maxTokens,
    signal: req.signal,
  });

  return {
    output: result.output,
    tokenUsage: result.tokenUsage,
    attempts: result.attempts,
  };
}
