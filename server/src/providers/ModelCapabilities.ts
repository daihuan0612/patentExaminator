/**
 * 统一模型能力声明接口 — bug5 模型自适应框架的基石
 *
 * 所有自适应维度（maxTokens/temperature/contextWindow/structuredOutput/systemPrompt/vision）
 * 共享同一个能力模型。adapter 层和 orchestrator 层都通过此接口查询模型能力。
 */

export interface ModelCapabilities {
  /** 上下文窗口大小 (tokens) */
  contextWindow: number;

  /** 最大输出 tokens */
  maxOutputTokens: number;

  /** 是否为推理模型 (产生 thinking tokens) */
  isReasoning: boolean;

  /** temperature 支持情况 */
  temperature: {
    supported: boolean;
    range: [number, number]; // [min, max]
  };

  /** 是否支持 structured output (response_format: json_schema) */
  supportsStructuredOutput: boolean;

  /** 是否支持视觉/图片输入 */
  supportsVision: boolean;

  /** 系统提示传递方式 */
  systemPromptMode: "message" | "parameter" | "none";
  // "message" = OpenAI 风格 system role message
  // "parameter" = Gemini 风格 systemInstruction 参数
  // "none" = 不支持系统提示
}
