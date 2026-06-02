import { describe, it, expect } from "vitest";
import { AgentClient } from "@client/agent/AgentClient";
import type { ClaimChartResponse } from "@client/agent/contracts";

describe("AgentClient real mode", () => {
  it("throws when gateway returns error", async () => {
    // Mock fetch to return error
    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "no-api-keys", message: "No API keys" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );

    const client = new AgentClient("real", "http://localhost:3000/api");
    await expect(
      client.run<ClaimChartResponse>("claim-chart", {
        caseId: "test",
        claimText: "test claim",
        claimNumber: 1,
        specificationText: "test spec"
      }, "test")
    ).rejects.toThrow("No API keys");

    global.fetch = originalFetch;
  });

  it("returns parsed JSON on success", async () => {
    const mockResponse = {
      ok: true,
      output: {
        claimNumber: 1,
        features: [
          {
            id: "test-chart-1-A",
            featureCode: "A",
            description: "散热基板",
            source: "ai",
            specificationCitations: [],
            citationStatus: "needs-review"
          }
        ],
        warnings: [],
        pendingSearchQuestions: [],
        legalCaution: "test"
      },
      tokenUsage: { input: 100, output: 50, total: 150 },
      attempts: [{ providerId: "gemini", modelId: "gemini-2.5-flash-lite", duration: 100 }]
    };

    const originalFetch = global.fetch;
    global.fetch = async () =>
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    const client = new AgentClient("real", "http://localhost:3000/api");
    const result = await client.run<ClaimChartResponse>("claim-chart", {
      caseId: "test",
      claimText: "test claim",
      claimNumber: 1,
      specificationText: "test spec"
    }, "test");

    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe("test-chart-1-A");
    expect(result.features[0]!.source).toBe("ai");
    global.fetch = originalFetch;
  });

  it("sends correct request format", async () => {
    let capturedBody: unknown;
    const originalFetch = global.fetch;
    global.fetch = async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          ok: true,
          output: {
            claimNumber: 1,
            features: [
              {
                id: "g1-led-chart-1-A",
                featureCode: "A",
                description: "LED散热装置",
                source: "ai",
                specificationCitations: [],
                citationStatus: "needs-review"
              }
            ],
            warnings: [],
            pendingSearchQuestions: [],
            legalCaution: "test"
          },
          tokenUsage: { input: 100, output: 50, total: 150 },
          attempts: [{ providerId: "gemini", modelId: "gemini-2.5-flash-lite", duration: 100 }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new AgentClient("real", "http://localhost:3000/api");
    await client.run<ClaimChartResponse>("claim-chart", {
      caseId: "g1-led",
      claimText: "一种LED散热装置",
      claimNumber: 1,
      specificationText: "test"
    }, "g1-led");

    expect(capturedBody).toMatchObject({
      agent: "claim-chart",
      caseId: "g1-led",
      providerPreference: expect.arrayContaining(["gemini"]),
    });
    global.fetch = originalFetch;
  });
});
