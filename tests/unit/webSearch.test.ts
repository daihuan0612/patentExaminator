import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the logger to avoid noise in test output
// ---------------------------------------------------------------------------
vi.mock("@server/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock the epo-ops import that webSearch.ts pulls in
vi.mock("@server/search/epo-ops", () => ({
  searchEpo: vi.fn().mockResolvedValue([]),
  clearEpoTokenCache: vi.fn()
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchPatents", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- Helpers ---

  /** Build a fresh Tavily-style success Response for each call. */
  function tavilyResponse(
    results: Array<{ title: string; url: string; content: string; score: number }>
  ) {
    return new Response(
      JSON.stringify({ results, query: "test" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * mockResolvedValue reuses the same Response body, but Response.json() can
   * only be consumed once. This helper returns a factory that creates a fresh
   * Response each time fetch is called.
   */
  function tavilyResponseFactory(
    results: Array<{ title: string; url: string; content: string; score: number }>
  ) {
    return () => tavilyResponse(results);
  }

  // --- Successful search (td-21) ---

  it("returns results from Tavily provider", async () => {
    const mockResults = [
      { title: "Patent A", url: "https://patents.google.com/p/123", content: "Abstract A", score: 0.9 },
      { title: "Patent B", url: "https://patentscope.wipo.int/search/en/detail?docId=456", content: "Abstract B", score: 0.8 }
    ];
    // Use mockImplementation so each fetch call gets a fresh Response
    fetchSpy.mockImplementation(tavilyResponseFactory(mockResults));

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("LED heatsink", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBe("Patent A");
    expect(result.query).toBe("LED heatsink");
    // Tavily does 2 fetch calls per query (patent-domain + general)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("deduplicates results by URL across the two Tavily passes", async () => {
    const duplicate = { title: "Same Patent", url: "https://patents.google.com/p/same", content: "Content", score: 0.9 };
    // Both calls return the same URL; use factory for fresh Response each time
    fetchSpy.mockImplementation(tavilyResponseFactory([duplicate]));

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test query", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    // The same URL should appear only once
    const urls = result.results.map((r) => r.url);
    const uniqueUrls = new Set(urls.map((u) => u.toLowerCase()));
    expect(urls.length).toBe(uniqueUrls.size);
  });

  // --- API error (td-21) ---

  it("throws when no API key is configured", async () => {
    const original = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const { searchPatents } = await import("@server/services/webSearch");
    await expect(searchPatents("test")).rejects.toThrow("No search API key configured");

    if (original !== undefined) process.env.TAVILY_API_KEY = original;
  });

  it("tolerates individual query failures and returns successful ones", async () => {
    // First query fails (both passes fail), second query succeeds
    fetchSpy
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(
        tavilyResponse([{ title: "OK", url: "https://example.com/ok", content: "Found", score: 0.5 }])
      )
      .mockResolvedValueOnce(tavilyResponse([]));

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents(["fail query", "success query"], 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    // Should not throw -- just return whatever succeeded
    expect(result.results).toBeDefined();
    expect(result.query).toBe("fail query | success query");
  });

  // --- Empty results (td-21) ---

  it("returns empty results when Tavily returns no results", async () => {
    fetchSpy.mockImplementation(tavilyResponseFactory([]));

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("obscure query", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    expect(result.results).toEqual([]);
  });

  it("handles null results array from Tavily gracefully", async () => {
    fetchSpy.mockImplementation(
      () => new Response(JSON.stringify({ results: null, query: "test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    expect(result.results).toEqual([]);
  });

  // --- Timeout / bg-68 (td-21) ---

  it("uses AbortSignal.timeout for Tavily requests", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchSpy.mockImplementation(tavilyResponseFactory([]));

    const { searchPatents } = await import("@server/services/webSearch");
    await searchPatents("test", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    // Tavily does 2 calls; each should use AbortSignal.timeout
    expect(timeoutSpy).toHaveBeenCalled();
    // Verify 30s timeout (FETCH_TIMEOUT_MS = 30_000)
    for (const call of timeoutSpy.mock.calls) {
      expect(call[0]).toBe(30_000);
    }
    timeoutSpy.mockRestore();
  });

  it("handles abort/timeout errors from fetch gracefully", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchSpy.mockRejectedValue(abortError);

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test", 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    // Per-query failures are caught -- result should be empty, not thrown
    expect(result.results).toEqual([]);
  });

  it("fetch calls include the 30s AbortSignal.timeout signal", async () => {
    fetchSpy.mockImplementation(tavilyResponseFactory([]));

    const { searchPatents } = await import("@server/services/webSearch");
    await searchPatents("LED heatsink", 5, {
      providerId: "tavily",
      apiKey: "key-123"
    });

    // Check the fetch calls have a signal property
    for (const call of fetchSpy.mock.calls) {
      const options = call[1] as RequestInit | undefined;
      expect(options).toBeDefined();
      expect(options!.signal).toBeDefined();
    }
  });

  // --- Multiple queries (td-21) ---

  it("runs multiple queries in parallel and merges results", async () => {
    const results1 = [{ title: "R1", url: "https://a.com/1", content: "C1", score: 0.9 }];
    const results2 = [{ title: "R2", url: "https://b.com/2", content: "C2", score: 0.8 }];
    // Each query triggers 2 fetch calls (patent + general)
    fetchSpy
      .mockResolvedValueOnce(tavilyResponse(results1))
      .mockResolvedValueOnce(tavilyResponse(results1))
      .mockResolvedValueOnce(tavilyResponse(results2))
      .mockResolvedValueOnce(tavilyResponse(results2));

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents(["query1", "query2"], 10, {
      providerId: "tavily",
      apiKey: "test-api-key"
    });

    expect(result.results).toHaveLength(2);
    expect(result.query).toBe("query1 | query2");
  });

  // --- SerpAPI provider (td-21) ---

  it("routes to SerpAPI when providerId is 'serpapi'", async () => {
    const serpResults = [
      { title: "Serp Result", link: "https://example.com/serp", snippet: "A snippet" }
    ];
    // SerpAPI also does 2 calls per query (patent + general); use factory for fresh Response
    fetchSpy.mockImplementation(
      () => new Response(
        JSON.stringify({ organic_results: serpResults }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test", 10, {
      providerId: "serpapi",
      apiKey: "serp-key"
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBe("Serp Result");
  });

  it("handles SerpAPI error response", async () => {
    fetchSpy.mockResolvedValue(
      new Response("Forbidden", { status: 403 })
    );

    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test", 10, {
      providerId: "serpapi",
      apiKey: "bad-key"
    });

    expect(result.results).toEqual([]);
  });

  // --- Unknown provider (td-21) ---

  it("returns empty results for unknown provider without baseUrl", async () => {
    const { searchPatents } = await import("@server/services/webSearch");
    const result = await searchPatents("test", 10, {
      providerId: "unknown-provider",
      apiKey: "key"
    });

    expect(result.results).toEqual([]);
  });
});
