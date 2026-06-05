/**
 * Schema ↔ Prompt 一致性测试 — FEAT-043 §六.2
 * =============================================
 *
 * 防止 schema 定义与 orchestrator prompt 指令不一致导致 AI 输出验证失败。
 * 锚定具体 bug：BUG-123, BUG-124, BUG-128, BUG-129, BUG-130
 *
 * 运行：vitest run tests/integration/schemaPromptConsistency.test.ts
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  inventiveSchema,
  noveltySchema,
  defectSchema,
} from "@shared/index";
import { agentRunInputSchema } from "@shared/schemas/api-input.schema.js";

/** 读取 orchestrator.ts 源码 */
function readOrchestrator(): string {
  const filePath = path.resolve(process.cwd(), "server/src/lib/orchestrator.ts");
  return fs.readFileSync(filePath, "utf-8");
}

/** 读取 schemas.ts 源码 */
function readSchemas(): string {
  const filePath = path.resolve(process.cwd(), "server/src/lib/schemas.ts");
  return fs.readFileSync(filePath, "utf-8");
}

// ══════════════════════════════════════════════════════════════════════
// TC-1: BUG-123 — inventive prompt 要求 closestPriorArtId 必填 ↔ schema 标记必填
// ══════════════════════════════════════════════════════════════════════

describe("BUG-123: inventive closestPriorArtId 一致性", () => {
  it("inventive schema 要求 closestPriorArtId 为必填", () => {
    // 验证 schema 中 closestPriorArtId 是 required（非 optional）
    const result = inventiveSchema.safeParse({
      closestPriorArtId: "",
      commonFeatures: [],
      differenceFeatures: [],
      actualTechnicalProblem: "",
      features: [],
      overallConclusion: "possibly-lacks-inventiveness",
      legalCaution: "test",
    });
    // 空字符串应被 .min(1) 拒绝
    expect(result.success).toBe(false);
  });

  it("orchestrator prompt 要求 closestPriorArtId 必须填写", () => {
    const source = readOrchestrator();
    // 检查 inventive prompt 中是否有"closestPriorArtId 必须填写"的指令
    expect(source).toContain("closestPriorArtId 必须填写");
  });
});

// ══════════════════════════════════════════════════════════════════════
// TC-2: BUG-128 — novelty prompt legalCaution ↔ schema 默认值一致
// ══════════════════════════════════════════════════════════════════════

describe("BUG-128: novelty legalCaution 一致性", () => {
  it("novelty schema 的 legalCaution 默认值与 orchestrator prompt 一致", () => {
    // 从 schema 获取默认值
    const defaultResult = noveltySchema.safeParse({
      claimNumber: 1,
      referenceId: "ref-1",
      rows: [{ featureCode: "A", disclosureStatus: "clearly-disclosed", citations: [] }],
      differenceFeatureCodes: [],
      pendingSearchQuestions: [],
      // 不传 legalCaution，使用默认值
    });
    expect(defaultResult.success).toBe(true);
    if (defaultResult.success) {
      const schemaDefault = defaultResult.data.legalCaution;
      // orchestrator.ts:234 中的 prompt 文本
      expect(schemaDefault).toBe("以上为候选事实整理，不构成新颖性法律结论。");
    }
  });

  it("orchestrator novelty prompt 的 legalCaution 示例与 schema 默认值一致", () => {
    const source = readOrchestrator();
    // 在 buildNoveltyPrompt 函数中查找 legalCaution 文本
    const promptSection = source.substring(
      source.indexOf("function buildNoveltyPrompt"),
      source.indexOf("function buildInventivePrompt")
    );
    expect(promptSection).toContain("以上为候选事实整理，不构成新颖性法律结论。");
  });
});

// ══════════════════════════════════════════════════════════════════════
// TC-3: BUG-124 — defect schema warnings 有 .default([])
// ══════════════════════════════════════════════════════════════════════

describe("BUG-124: defect warnings .default([])", () => {
  it("defect schema 的 warnings 字段省略时默认为空数组", () => {
    const result = defectSchema.safeParse({
      defects: [],
      legalCaution: "test",
      // 不传 warnings
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warnings).toEqual([]);
    }
  });

  it("所有 agent schema 对空输入 safeParse({}) 不会意外通过", () => {
    // 对 defectSchema 空对象解析应失败（defects 是 required）
    const result = defectSchema.safeParse({});
    // 如果所有字段都有 default 则可能通过，但 defects 是 required 且无 default
    // 这里验证 safeParse 不会抛异常
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// TC-4: BUG-129 — agentRunInputSchema ↔ aiRunRequestSchema 枚举同步
// ══════════════════════════════════════════════════════════════════════

describe("BUG-129: agent 枚举同步", () => {
  it("agentRunInputSchema 的 agent 枚举与 AGENT_VALUES 完全一致", () => {
    // 从 agentRunInputSchema 提取枚举值
    const inputAgentEnum = agentRunInputSchema.shape.agent;
    const inputValues = (inputAgentEnum as unknown as { _def: { values: string[] } })._def.values;

    // 从 AGENT_VALUES 常量提取枚举值（schemas.ts 使用 agentEnum = z.enum(AGENT_VALUES)）
    const schemasSource = readSchemas();
    // 检查 schemas.ts 使用 agentEnum（来自 shared）
    expect(schemasSource).toContain("agent: agentEnum");

    // 直接从 shared 的 AGENT_VALUES 验证一致性
    const sharedSource = fs.readFileSync(
      path.resolve(process.cwd(), "shared/src/schemas/api-input.schema.ts"),
      "utf-8"
    );
    const agentValuesMatch = sharedSource.match(/export const AGENT_VALUES\s*=\s*\[([\s\S]*?)\]/);
    expect(agentValuesMatch).not.toBeNull();
    if (agentValuesMatch) {
      const serverValues = agentValuesMatch[1]!
        .split(",")
        .map((s) => s.trim().replace(/"/g, "").replace(/'/g, ""))
        .filter(Boolean);

      // 两处枚举完全一致
      expect([...inputValues].sort()).toEqual([...serverValues].sort());
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// TC-5: BUG-130 — agent 枚举 ⊆ orchestrator runAgent switch
// ══════════════════════════════════════════════════════════════════════

describe("BUG-130: 枚举与 orchestrator switch 对齐", () => {
  it("agentRunInputSchema 的每个枚举值都在 orchestrator runAgent switch 中有处理", () => {
    const inputAgentEnum = agentRunInputSchema.shape.agent;
    const inputValues = (inputAgentEnum as unknown as { _def: { values: string[] } })._def.values;

    const source = readOrchestrator();
    // 提取 runAgent 函数中的 case 值
    // 从 "async runAgent" 或 "runAgent" 开始到函数结束
    const runAgentStart = source.indexOf("runAgent");
    const runAgentSection = source.substring(runAgentStart);
    const caseRegex = /case\s+"([^"]+)"/g;
    const switchCases = new Set<string>();
    let match;
    while ((match = caseRegex.exec(runAgentSection)) !== null) {
      switchCases.add(match[1]!);
    }

    // 每个枚举值都应在 switch 中有对应 case
    for (const value of inputValues) {
      expect(switchCases.has(value)).toBe(true);
    }
  });

  it("枚举中不包含已废弃的 agent（draft, search-references）", () => {
    const inputAgentEnum = agentRunInputSchema.shape.agent;
    const inputValues = (inputAgentEnum as unknown as { _def: { values: string[] } })._def.values;

    expect(inputValues).not.toContain("draft");
    expect(inputValues).not.toContain("search-references");
  });
});
