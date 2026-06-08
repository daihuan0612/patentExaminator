const API_BASE = "/api";

export async function fetchModels(providerId: string, apiKey: string, baseUrl?: string): Promise<string[]> {
  const params = new URLSearchParams({ apiKey });
  if (baseUrl) params.set("baseUrl", baseUrl);
  const url = `${API_BASE}/providers/${encodeURIComponent(providerId)}/models?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { models: string[] };
  return data.models;
}

/** bug9: 从 server 获取完整模型目录（含能力元数据，无需 API Key） */
export async function fetchModelCatalog(): Promise<Record<string, Array<{ id: string; recommendation?: string; rpm?: number; rpd?: number; tpm?: string; contextWindow?: number; maxOutputTokens?: number; isReasoning?: boolean; supportsVision?: boolean; supportsStructuredOutput?: boolean }>>> {
  const res = await fetch(`${API_BASE}/providers/models`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, Array<{ id: string; recommendation?: string; rpm?: number; rpd?: number; tpm?: string; contextWindow?: number; maxOutputTokens?: number; isReasoning?: boolean; supportsVision?: boolean; supportsStructuredOutput?: boolean }>>>;
}
