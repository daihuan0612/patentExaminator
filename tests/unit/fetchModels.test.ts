import { describe, it, expect, vi, afterEach } from "vitest";

describe("fetchModels baseUrl parameter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes baseUrl as query parameter when provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["mimo-v2.5-pro"] })
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchModels } = await import("@client/lib/api");
    await fetchModels("mimo", "sk-test-key", "https://api.xiaomimimo.com/v1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url: string = fetchSpy.mock.calls[0]![0]! as string;
    expect(url).toContain("apiKey=sk-test-key");
    expect(url).toContain("baseUrl=https%3A%2F%2Fapi.xiaomimimo.com%2Fv1");
    expect(url).toContain("/providers/mimo/models");
  });

  it("does not include baseUrl query parameter when not provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: ["MiMo-V2.5-Pro"] })
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchModels } = await import("@client/lib/api");
    await fetchModels("mimo", "sk-test-key");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url: string = fetchSpy.mock.calls[0]![0]! as string;
    expect(url).toContain("apiKey=sk-test-key");
    expect(url).not.toContain("baseUrl=");
    expect(url).toContain("/providers/mimo/models");
  });

  it("correctly encodes baseUrl with special characters", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] })
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchModels } = await import("@client/lib/api");
    await fetchModels("glm", "key", "https://open.bigmodel.cn/api/paas/v4");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url: string = fetchSpy.mock.calls[0]![0]! as string;
    expect(url).toContain("baseUrl=https%3A%2F%2Fopen.bigmodel.cn%2Fapi%2Fpaas%2Fv4");
  });

  it("handles empty baseUrl gracefully by not appending it", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] })
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchModels } = await import("@client/lib/api");
    await fetchModels("mimo", "sk-key", "");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url: string = fetchSpy.mock.calls[0]![0]! as string;
    expect(url).not.toContain("baseUrl=");
  });

  it("passes baseUrl alongside apiKey for mimo pay-as-you-go endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] })
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchModels } = await import("@client/lib/api");
    await fetchModels("mimo", "sk-mimo-12345", "https://api.xiaomimimo.com/v1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url: string = fetchSpy.mock.calls[0]![0]! as string;
    expect(url).toContain("apiKey=sk-mimo-12345");
    expect(url).toContain("baseUrl=https%3A%2F%2Fapi.xiaomimimo.com%2Fv1");
  });
});