import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentClient } from "@client/agent/AgentClient";

describe("AgentClient (mock mode)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns mock claim chart features", async () => {
    const client = new AgentClient("mock");
    const result = await client.runClaimChart({
      caseId: "case-1",
      claimText: "一种LED散热装置，包括基板和设置在基板上的散热翅片",
      claimNumber: 1,
      specificationText: "本发明涉及LED散热技术领域"
    });

    expect(result.features.length).toBeGreaterThan(0);
    expect(result.features[0]!.source).toBe("mock");
    expect(result.legalCaution).toContain("不构成");
  });

  it("real mode attempts gateway call", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));

    const client = new AgentClient("real", "http://localhost:3000/api");
    await expect(
      client.runClaimChart({
        caseId: "case-1",
        claimText: "test",
        claimNumber: 1,
        specificationText: "test"
      })
    ).rejects.toThrow();
  }, 15000);

  it("real mode maps schema output to ClaimFeature with ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          output: {
            claimNumber: 1,
            features: [
              {
                featureCode: "A",
                description: "基板",
                specificationCitations: [{ label: "[0001]", confidence: "high" }],
                citationStatus: "confirmed"
              }
            ],
            warnings: [{ type: "other", message: "功能语言" }],
            pendingSearchQuestions: ["待查 D1"],
            legalCaution: "候选事实"
          },
          tokenUsage: { input: 100, output: 50, total: 150 },
          attempts: [{ providerId: "gemini", modelId: "gemini-2.5-flash-lite", duration: 100 }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const client = new AgentClient("real", "http://localhost:3000/api");
    const result = await client.runClaimChart({
      caseId: "case-1",
      claimText: "一种装置，包括基板",
      claimNumber: 1,
      specificationText: "[0001] 基板说明"
    });

    expect(result.features[0]!.id).toBe("case-1-chart-1-A");
    expect(result.features[0]!.source).toBe("ai");
    expect(result.warnings).toEqual(["功能语言"]);
  });

  it("real mode normalizes numeric paragraph in citations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          output: {
            claimNumber: 1,
            features: [
              {
                featureCode: "A",
                description: "基板",
                specificationCitations: [
                  { label: "[0005]", paragraph: 5, confidence: "high" }
                ],
                citationStatus: "confirmed"
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
      )
    );

    const client = new AgentClient("real", "http://localhost:3000/api");
    const result = await client.runClaimChart({
      caseId: "case-1",
      claimText: "一种装置",
      claimNumber: 1,
      specificationText: "spec"
    });

    expect(result.features[0]!.specificationCitations[0]?.paragraph).toBe("5");
  });

  it("real mode throws when gateway returns error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { type: "structure", message: "结构校验失败: features.0.featureCode: Invalid" }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const client = new AgentClient("real", "http://localhost:3000/api");
    await expect(
      client.runClaimChart({
        caseId: "case-1",
        claimText: "test",
        claimNumber: 1,
        specificationText: "test"
      })
    ).rejects.toThrow(/结构校验失败/);
  });
});
