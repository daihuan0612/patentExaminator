import { OpenAICompatibleAdapter } from "./ProviderAdapter.js";
import type { ProviderId } from "@shared/types/agents";

export class OpencodeAdapter extends OpenAICompatibleAdapter {
  id: ProviderId = "opencode";
  defaultBaseUrl = "https://opencode.ai/zen/v1";

  supportedModels(): string[] {
    return [
      "deepseek-v4-flash-free",
      "kimi-k2.5",
      "kimi-k2.6",
      "glm-5",
      "glm-5.1",
      "minimax-m2.5",
      "minimax-m2.7",
      "nemotron-3-super-free",
    ];
  }
}
