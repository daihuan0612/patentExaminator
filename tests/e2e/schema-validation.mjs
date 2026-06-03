/**
 * Schema 验证测试（表驱动）
 * ========================
 *
 * 测试 AI 输出的 Schema 验证逻辑。
 */

import {
  postJSON,
  log,
  buildMockRequest,
  validateClaimChartOutput,
  validateNoveltyOutput,
  validateInventiveOutput,
  validateOpinionAnalysisOutput,
  validateArgumentMappingOutput,
  validateReexamDraftOutput,
} from "../e2e-shared/index.mjs";

// ── Schema 验证测试（表驱动）─────────────────────────────────────────

async function runSchemaTest(label, agent, caseId, moduleScope, validator, extra) {
  const res = await postJSON("/ai/run", buildMockRequest({ agent, caseId, moduleScope, ...extra }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validator(data.outputJson);
    log(`Schema ${label}`, result.valid, result.errors.join("; "));
  } else {
    log(`Schema ${label}`, false, "no outputJson");
  }
}

const SCHEMA_TESTS = [
  { label: "ClaimChart", agent: "claim-chart", caseId: "g1-led", moduleScope: "claim-chart", validator: validateClaimChartOutput },
  { label: "Novelty", agent: "novelty", caseId: "g1-led", moduleScope: "novelty", validator: validateNoveltyOutput, extra: { extra: { expectedSchemaName: "novelty", referenceId: "g1-ref-d1" } } },
  { label: "Inventive", agent: "inventive", caseId: "g2-battery", moduleScope: "inventive", validator: validateInventiveOutput },
  { label: "OpinionAnalysis", agent: "opinion-analysis", caseId: "g1-led", moduleScope: "opinion-analysis", validator: validateOpinionAnalysisOutput },
  { label: "ArgumentMapping", agent: "argument-analysis", caseId: "g1-led", moduleScope: "argument-mapping", validator: validateArgumentMappingOutput },
  { label: "ReexamDraft", agent: "reexam-draft", caseId: "g1-led", moduleScope: "draft", validator: validateReexamDraftOutput },
];

for (const t of SCHEMA_TESTS) {
  const fn = async () => runSchemaTest(t.label, t.agent, t.caseId, t.moduleScope, t.validator, t.extra);
  Object.defineProperty(fn, "name", { value: `testSchema${t.label}` });
  globalThis[`testSchema${t.label}`] = fn;
}

export const testSchemaClaimChart = globalThis.testSchemaClaimChart;
export const testSchemaNovelty = globalThis.testSchemaNovelty;
export const testSchemaInventive = globalThis.testSchemaInventive;
export const testSchemaOpinionAnalysis = globalThis.testSchemaOpinionAnalysis;
export const testSchemaArgumentMapping = globalThis.testSchemaArgumentMapping;
export const testSchemaReexamDraft = globalThis.testSchemaReexamDraft;

// ── 错误处理测试 ────────────────────────────────────────────────────

export async function testInvalidAgent() {
  const res = await postJSON("/ai/run", {
    agent: "nonexistent-agent",
    providerPreference: ["gemini"],
    modelId: "mock",
    prompt: "test",
    sanitized: false,
    metadata: { caseId: "test", moduleScope: "test", tokenEstimate: 0 },
  });
  const data = await res.json();
  log("Invalid Agent returns error", data.ok === false || res.status >= 400,
    `status=${res.status}, ok=${data.ok}`);
}

export async function testMissingRequiredFields() {
  const res = await postJSON("/ai/run", {
    // 缺少 agent 字段
    providerPreference: ["gemini"],
    modelId: "mock",
    prompt: "test",
  });
  log("Missing Required Fields", res.status >= 400, `status=${res.status}`);
}

export async function testEmptyClaimText() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "claim-chart",
    caseId: "empty-test",
    extra: { prompt: "" },
  }));
  const data = await res.json();
  log("Empty Claim Text", data.ok === false || data.error,
    `ok=${data.ok}, error=${data.error?.message || "none"}`);
}

export async function testMockFixtureNotFound() {
  const res = await postJSON("/ai/run", {
    agent: "claim-chart",
    providerPreference: ["gemini"],
    modelId: "mock",
    prompt: "[Mock E2E test] claim-chart for case nonexistent-fixture",
    sanitized: false,
    mock: true,
    metadata: { caseId: "nonexistent-fixture", moduleScope: "claim-chart", tokenEstimate: 0 },
  });
  const data = await res.json();
  log("Mock Fixture Not Found", data.ok === false || data.error,
    `ok=${data.ok}, error=${data.error?.message || "none"}`);
}

export async function testResponseStructureValidation() {
  const res = await postJSON("/ai/run", buildMockRequest({ agent: "claim-chart", caseId: "g1-led" }));
  const data = await res.json();

  if (data.ok) {
    // 检查响应结构
    const hasOutput = data.outputJson || data.rawText;
    log("Response has output", !!hasOutput);

    // structureErrors 可能不存在（无错误）或为空数组
    const structureErrors = data.structureErrors;
    const noErrors = !structureErrors || (Array.isArray(structureErrors) && structureErrors.length === 0);
    log("Response structureErrors empty", noErrors,
      noErrors ? "no errors" : `errors: ${structureErrors.join("; ")}`);
  } else {
    log("Response Structure Validation", false, `request failed: ${data.error?.message}`);
  }
}

export async function testMalformedResponseHandling() {
  // 测试 1：valid fixture + extra fields → ok=true（验证多余字段被忽略）
  const res1 = await postJSON("/ai/run", {
    agent: "claim-chart",
    providerPreference: ["gemini"],
    modelId: "mock",
    prompt: "[Mock E2E test] claim-chart for case g1-led",
    sanitized: false,
    mock: true,
    metadata: { caseId: "g1-led", moduleScope: "claim-chart", tokenEstimate: 0 },
    invalidField: "should be ignored",
    anotherInvalid: 123,
  });
  const data1 = await res1.json();
  log("Malformed Response: extra fields ignored", data1.ok === true,
    `ok=${data1.ok}`);

  // 测试 2：unknown fixture → ok=false, error.code === "mock-fixture-not-found"
  const res2 = await postJSON("/ai/run", {
    agent: "claim-chart",
    providerPreference: ["gemini"],
    modelId: "mock",
    prompt: "[Mock E2E test] claim-chart for case nonexistent-case-999",
    sanitized: false,
    mock: true,
    metadata: { caseId: "nonexistent-case-999", moduleScope: "claim-chart", tokenEstimate: 0 },
  });
  const data2 = await res2.json();
  log("Malformed Response: unknown fixture returns error", data2.ok === false,
    `ok=${data2.ok}, code=${data2.error?.code}`);
  if (!data2.ok) {
    log("Malformed Response: error code is mock-fixture-not-found",
      data2.error?.code === "mock-fixture-not-found",
      `code=${data2.error?.code}`);
  }
}

