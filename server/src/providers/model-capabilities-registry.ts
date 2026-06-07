/**
 * 模型能力注册表 — 前缀匹配查询
 *
 * 精确前缀匹配 → 最长前缀胜出 → 保守默认值。
 * D1 的 thinkingModelCache 可在运行时覆盖 isReasoning 字段。
 */

import type { ModelCapabilities } from "./ModelCapabilities.js";

// 按 modelId 前缀匹配的默认能力表
// 精确匹配优先于前缀匹配
const CAPABILITY_PRESETS: Record<string, Partial<ModelCapabilities>> = {
  // ── 推理模型系列 ──
  "gemini-2.5":     { isReasoning: true,  contextWindow: 1_048_576, maxOutputTokens: 65_536, temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: true,  supportsVision: true,  systemPromptMode: "parameter" },
  "gemini-3":       { isReasoning: true,  contextWindow: 1_048_576, maxOutputTokens: 65_536, temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: true,  supportsVision: true,  systemPromptMode: "parameter" },
  "mimo-v2":        { isReasoning: true,  contextWindow: 131_072,   maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "deepseek-reasoner": { isReasoning: true, contextWindow: 65_536, maxOutputTokens: 16_384, temperature: { supported: false, range: [0, 1] }, supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "deepseek-v4":    { isReasoning: true,  contextWindow: 131_072,   maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "kimi-k2":        { isReasoning: true,  contextWindow: 131_072,   maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "glm-5":          { isReasoning: true,  contextWindow: 131_072,   maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "doubao-1.5":     { isReasoning: true,  contextWindow: 131_072,   maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },

  // ── 带 provider 前缀的模型（OpenRouter 等）──
  "anthropic/claude-opus-4": { isReasoning: true, contextWindow: 200_000, maxOutputTokens: 32_768, temperature: { supported: true, range: [0, 1] }, supportsStructuredOutput: true, supportsVision: true, systemPromptMode: "message" },
  "openai/gpt-5":   { isReasoning: true, contextWindow: 128_000, maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 2] }, supportsStructuredOutput: true, supportsVision: true, systemPromptMode: "message" },
  "google/gemini-": { isReasoning: true, contextWindow: 1_048_576, maxOutputTokens: 65_536, temperature: { supported: true, range: [0, 2] }, supportsStructuredOutput: true, supportsVision: true, systemPromptMode: "parameter" },

  // ── 非推理模型 ──
  "gemini-2.0":     { isReasoning: false, contextWindow: 1_048_576, maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: true,  supportsVision: true,  systemPromptMode: "parameter" },
  "deepseek-chat":  { isReasoning: false, contextWindow: 65_536,   maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "gpt-4o":         { isReasoning: false, contextWindow: 128_000,  maxOutputTokens: 16_384, temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: true,  supportsVision: true,  systemPromptMode: "message" },
  "qwen-":          { isReasoning: false, contextWindow: 131_072,  maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 2] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "moonshot-":      { isReasoning: false, contextWindow: 131_072,  maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "glm-4":          { isReasoning: false, contextWindow: 131_072,  maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "minimax-":       { isReasoning: false, contextWindow: 65_536,   maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
  "doubao-2.0":     { isReasoning: false, contextWindow: 131_072,  maxOutputTokens: 8_192,  temperature: { supported: true, range: [0, 1] },  supportsStructuredOutput: false, supportsVision: false, systemPromptMode: "message" },
};

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  isReasoning: false,
  temperature: { supported: true, range: [0, 2] },
  supportsStructuredOutput: false,
  supportsVision: false,
  systemPromptMode: "message",
};

/**
 * 获取模型能力。匹配逻辑：精确前缀匹配 → 最长前缀胜出 → 默认值。
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
  const normalized = modelId.toLowerCase();

  // 精确匹配
  if (CAPABILITY_PRESETS[normalized]) {
    return { ...DEFAULT_CAPABILITIES, ...CAPABILITY_PRESETS[normalized] };
  }

  // 最长前缀匹配
  let bestMatch: string | null = null;
  for (const prefix of Object.keys(CAPABILITY_PRESETS)) {
    if (normalized.startsWith(prefix.toLowerCase())) {
      if (!bestMatch || prefix.length > bestMatch.length) {
        bestMatch = prefix;
      }
    }
  }

  if (bestMatch) {
    return { ...DEFAULT_CAPABILITIES, ...CAPABILITY_PRESETS[bestMatch] };
  }

  return { ...DEFAULT_CAPABILITIES };
}
