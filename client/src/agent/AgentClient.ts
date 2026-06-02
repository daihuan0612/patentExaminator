/**
 * Agent client — B-038: 简化为 API 客户端，只负责调用 /api/agent/run
 *
 * Mock 模式由服务端处理（/agent/run 支持 mock: true）
 * 协调逻辑由服务端 orchestrator.ts 处理
 */
import type {
  SearchReferencesRequest,
  SearchReferencesResponse,
  ExtractSearchTermsRequest,
  ExtractSearchTermsResponse,
  SearchWithTermsRequest,
  AgentRunOptions,
  AiErrorType
} from "./contracts";
import { AiGatewayError } from "./contracts";
import type { ProviderId, ProviderConnection, AgentAssignment, AppSettings, ProviderErrorMessage } from "@shared/types/agents";
import { useSettingsStore } from "../store/features/settings/settingsSlice";
import { waitForServerReady, clearServerReadyCache } from "../lib/serverReady";
import { createLogger } from "../lib/logger";

const log = createLogger("AgentClient");

export class AgentClient {
  /** 最近一次知识库注入的引用详情（静态，供 UI 读取） */
  static lastKnowledgeCitations: Array<{ source: string; score: number; excerpt: string }> = [];

  private agentAssignments: AgentAssignment[];
  private fallbackProvider: ProviderId;
  private fallbackModel: string;
  private enabledProviders: ProviderId[];
  private providerSettings: ProviderConnection[];
  private enableProviderFallback: boolean;
  private llmApiKey: string;
  private knowledgeConfig: { enabled: boolean } | undefined;

  constructor(
    private mode: "mock" | "real",
    private gatewayUrl: string = "/api",
    settings?: AppSettings | AgentAssignment[]
  ) {
    if (Array.isArray(settings)) {
      this.agentAssignments = settings;
      this.fallbackProvider = "gemini";
      this.fallbackModel = "gemini-3.1-flash-lite-preview";
      this.enabledProviders = ["gemini", "mimo"];
      this.providerSettings = [];
      this.enableProviderFallback = true;
      this.llmApiKey = "";
      this.knowledgeConfig = undefined;
    } else if (settings) {
      this.agentAssignments = settings.agents ?? [];
      const enabled = settings.providers.filter((p) => p.enabled && p.apiKeyRef);
      const firstEnabled = enabled[0];
      this.fallbackProvider = (firstEnabled?.providerId as ProviderId) ?? "gemini";
      this.fallbackModel = firstEnabled?.defaultModelId ?? "gemini-3.1-flash-lite-preview";
      this.enabledProviders = enabled.map((p) => p.providerId as ProviderId);
      this.providerSettings = settings.providers;
      this.enableProviderFallback = settings.enableProviderFallback ?? true;
      this.llmApiKey = firstEnabled?.apiKeyRef ?? "";
      this.knowledgeConfig = settings.knowledge;
    } else {
      this.agentAssignments = [];
      this.fallbackProvider = "gemini";
      this.fallbackModel = "gemini-3.1-flash-lite-preview";
      this.enabledProviders = ["gemini", "mimo"];
      this.providerSettings = [];
      this.enableProviderFallback = true;
      this.llmApiKey = "";
      this.knowledgeConfig = undefined;
    }
  }

  /** 通用 agent 运行入口 — 调用 /api/agent/run */
  async run<T>(
    agent: string,
    request: object,
    caseId?: string,
    options?: AgentRunOptions
  ): Promise<T> {
    const id = caseId ?? (request as Record<string, unknown>).caseId as string ?? "";
    return this.callGateway<T>(agent, request as Record<string, unknown>, { caseId: id, ...options });
  }

  /** 检索文献搜索 — 调用 /api/search-references */
  async searchReferences(request: SearchReferencesRequest, options?: AgentRunOptions): Promise<SearchReferencesResponse> {
    return this.postJson<SearchReferencesResponse>("/search-references", {
      ...this.buildSearchBase(request, options),
      maxResults: request.maxResults ?? 5,
      searchProviderId: request.searchProviderId,
      searchApiKey: request.searchApiKey,
      searchBaseUrl: request.searchBaseUrl,
    });
  }

  /** 提取检索词 — 调用 /api/extract-search-terms */
  async extractSearchTerms(request: ExtractSearchTermsRequest, options?: AgentRunOptions): Promise<ExtractSearchTermsResponse> {
    return this.postJson<ExtractSearchTermsResponse>("/extract-search-terms", this.buildSearchBase(request, options));
  }

  /** 用检索词搜索 — 调用 /api/search-with-terms */
  async searchWithTerms(request: SearchWithTermsRequest, options?: AgentRunOptions): Promise<SearchReferencesResponse> {
    return this.postJson<SearchReferencesResponse>("/search-with-terms", {
      ...this.buildSearchBase(request, options),
      searchQueries: request.searchQueries,
      maxResults: request.maxResults ?? 5,
      searchProviderId: request.searchProviderId,
      searchApiKey: request.searchApiKey,
      searchBaseUrl: request.searchBaseUrl,
    });
  }

  private buildSearchBase(request: { caseId: string; claimText: string; features: unknown[] }, options?: AgentRunOptions) {
    const resolved = this.resolveAgent("search-references") ?? {
      providerId: this.enabledProviders[0] ?? this.fallbackProvider,
      modelId: this.fallbackModel
    };
    const providerId = (options?.providerId ?? resolved.providerId) as ProviderId;
    const modelId = options?.modelId ?? resolved.modelId;
    return {
      caseId: request.caseId,
      claimText: request.claimText,
      features: request.features,
      providerPreference: this.buildProviderPreference(providerId),
      modelId,
      llmApiKey: this.llmApiKey || undefined,
      ...this.buildProviderOptions(),
    };
  }

  // ── Private helpers ──────────────────────────────────────

  private resolveAgent(gatewayAgent: string): { providerId: ProviderId; modelId: string; maxTokens?: number } | null {
    const assignment = this.agentAssignments.find((a) => a.agent === gatewayAgent);
    if (!assignment) return null;
    const providerId = assignment.providerOrder[0] ?? this.fallbackProvider;
    const providerSetting = this.providerSettings.find((p) => p.providerId === providerId);
    const modelId = providerSetting?.defaultModelId ?? assignment.modelId;
    return { providerId, modelId, maxTokens: assignment.maxTokens };
  }

  private buildProviderPreference(primaryProvider: ProviderId): ProviderId[] {
    return this.enableProviderFallback
      ? [primaryProvider, ...this.enabledProviders.filter((p) => p !== primaryProvider)]
      : [primaryProvider];
  }

  private buildProviderOptions() {
    const modelFallbacks: Partial<Record<ProviderId, string[]>> = {};
    const enableModelFallback: Partial<Record<ProviderId, boolean>> = {};
    const providerBaseUrls: Partial<Record<ProviderId, string>> = {};
    for (const p of this.providerSettings) {
      modelFallbacks[p.providerId] = p.modelFallbacks ?? p.modelIds;
      enableModelFallback[p.providerId] = p.enableModelFallback ?? true;
      if (p.baseUrl) providerBaseUrls[p.providerId] = p.baseUrl;
    }
    return { modelFallbacks, enableModelFallback, providerBaseUrls };
  }

  private async callGateway<T>(
    agent: string,
    request: Record<string, unknown>,
    meta: { caseId: string; signal?: AbortSignal | null }
  ): Promise<T> {
    await waitForServerReady(this.gatewayUrl);

    const resolved = this.resolveAgent(agent) ?? { providerId: this.fallbackProvider, modelId: this.fallbackModel, maxTokens: undefined };
    const providerPreference = this.buildProviderPreference(resolved.providerId);

    const body = {
      agent,
      caseId: meta.caseId,
      request,
      providerPreference,
      modelId: resolved.modelId,
      ...(resolved.maxTokens != null ? { maxTokens: resolved.maxTokens } : {}),
      ...this.buildProviderOptions(),
      knowledgeEnabled: this.knowledgeConfig?.enabled ?? false,
      ...(this.mode === "mock" ? { mock: true } : {}),
    };

    log("Calling agent gateway", { agent, providerPreference, modelId: resolved.modelId, caseId: meta.caseId });

    const doFetch = async (): Promise<Response> => {
      return fetch(`${this.gatewayUrl}/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(meta.signal ? { signal: meta.signal } : {})
      });
    };

    let res: Response;
    try {
      res = await doFetch();
    } catch {
      if (meta.signal?.aborted) {
        throw new AiGatewayError("abort", "请求已取消");
      }
      clearServerReadyCache();
      try {
        await waitForServerReady(this.gatewayUrl, true);
        res = await doFetch();
      } catch {
        throw new AiGatewayError("network", "无法连接到 AI 服务，请检查网络连接和服务器状态。");
      }
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const msg = errorBody.error?.message ?? `Gateway error: ${res.status}`;
      const attempts = errorBody.attempts as Array<{ providerId: string; errorCode?: string }> | undefined;
      this.trackProviderErrors(attempts, agent, meta.caseId);
      const errorType = classifyGatewayError(res.status, errorBody, attempts);
      const detail = attempts?.length
        ? ` (${attempts.map((a) => `${a.providerId}: ${a.errorCode ?? "failed"}`).join("; ")})`
        : "";
      throw new AiGatewayError(errorType, `${msg}${detail}`, attempts);
    }

    const data = await res.json() as {
      ok: boolean; output?: unknown;
      tokenUsage?: { input: number; output: number; total: number };
      attempts?: Array<{ providerId: string; modelId: string; errorCode?: string; duration: number }>;
      error?: { type: string; message: string };
      knowledgeCitations?: Array<{ source: string; score: number; excerpt: string }>
    };
    if (!data.ok) {
      const msg = data.error?.message ?? "Gateway returned error";
      const attempts = data.attempts?.map(a => {
        const result: { providerId: string; errorCode?: string } = { providerId: a.providerId };
        if (a.errorCode !== undefined) result.errorCode = a.errorCode;
        return result;
      });
      this.trackProviderErrors(attempts, agent, meta.caseId);
      const errorBody: { error?: { code?: string } } = {};
      if (data.error) errorBody.error = { code: data.error.type };
      const errorType = classifyGatewayError(res.status, errorBody, attempts);
      const detail = data.attempts?.length
        ? ` (${data.attempts.map((a) => `${a.providerId}: ${a.errorCode ?? "failed"}`).join("; ")})`
        : "";
      throw new AiGatewayError(errorType, `${msg}${detail}`, attempts);
    }

    // Track token usage
    if (data.tokenUsage && meta.caseId) {
      const { useTokenUsageStore } = await import("../store/features/tokenUsage/tokenUsageSlice");
      useTokenUsageStore.getState().addRecord({
        caseId: meta.caseId,
        agent,
        providerId: data.attempts?.[0]?.providerId ?? "unknown",
        modelId: body.modelId ?? "unknown",
        inputTokens: data.tokenUsage.input,
        outputTokens: data.tokenUsage.output,
        totalTokens: data.tokenUsage.total
      });
    }

    // Update knowledge citations
    if (data.knowledgeCitations) {
      AgentClient.lastKnowledgeCitations = data.knowledgeCitations;
    }

    if (data.output) {
      return data.output as T;
    }
    throw new Error("Empty response from gateway");
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const doFetch = async (): Promise<Response> => {
      return fetch(`${this.gatewayUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    let res: Response;
    try {
      res = await doFetch();
    } catch {
      clearServerReadyCache();
      await waitForServerReady(this.gatewayUrl, true);
      res = await doFetch();
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error ?? `Request error: ${res.status}`);
    }

    return (await res.json()) as T;
  }

  private trackProviderErrors(
    attempts: Array<{ providerId: string; ok?: boolean; errorCode?: string }> | undefined,
    agent: string,
    caseId: string
  ): void {
    if (!attempts || attempts.length === 0) return;
    try {
      const store = useSettingsStore.getState();
      for (const a of attempts) {
        if (a.ok) continue;
        store.addProviderError({
          providerId: a.providerId as ProviderId,
          errorCode: a.errorCode ?? "unknown",
          message: `Provider ${a.providerId} failed: ${a.errorCode ?? "unknown error"}`,
          timestamp: new Date().toISOString(),
          read: false,
          agent,
          caseId
        } as Omit<ProviderErrorMessage, "id">);
      }
    } catch {
      // Silently ignore errors during error tracking
    }
  }
}

function classifyGatewayError(
  status: number,
  errorBody: { error?: { code?: string } },
  attempts?: Array<{ providerId: string; errorCode?: string }>
): AiErrorType {
  if (attempts?.length) {
    const errorCodes = attempts.map((a) => a.errorCode);
    const allSame = (code: string) => errorCodes.every((c) => c === code);
    if (allSame("quota-exceeded")) return "quota";
    if (allSame("auth-failed")) return "auth";
    if (allSame("timeout")) return "timeout";
    if (errorCodes.every((c) => c === "network-error" || c === "server-error")) return "network";
    const hasQuota = errorCodes.some((c) => c === "quota-exceeded");
    if (hasQuota) return "quota";
  }
  if (errorBody.error?.code === "no-api-keys") return "auth";
  if (errorBody.error?.code === "quota-exceeded" || status === 429) return "quota";
  if (errorBody.error?.code === "auth-failed" || status === 401) return "auth";
  if (status >= 500) return "network";
  return "other";
}
