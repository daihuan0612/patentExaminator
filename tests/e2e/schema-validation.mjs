/**
 * Schema 验证测试
 * ===============
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
  validateSearchReferencesOutput,
} from "../e2e-shared/index.mjs";

// ── Schema 验证测试 ─────────────────────────────────────────────────

export async function testSchemaClaimChart() {
  const res = await postJSON("/ai/run", buildMockRequest({ agent: "claim-chart", caseId: "g1-led" }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateClaimChartOutput(data.outputJson);
    log("Schema ClaimChart", result.valid, result.errors.join("; "));
  } else {
    log("Schema ClaimChart", false, "no outputJson");
  }
}

export async function testSchemaNovelty() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "novelty",
    caseId: "g1-led",
    moduleScope: "novelty",
    extra: { expectedSchemaName: "novelty", referenceId: "g1-ref-d1" },
  }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateNoveltyOutput(data.outputJson);
    log("Schema Novelty", result.valid, result.errors.join("; "));
  } else {
    log("Schema Novelty", false, "no outputJson");
  }
}

export async function testSchemaInventive() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "inventive",
    caseId: "g2-battery",
    moduleScope: "inventive",
  }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateInventiveOutput(data.outputJson);
    log("Schema Inventive", result.valid, result.errors.join("; "));
  } else {
    log("Schema Inventive", false, "no outputJson");
  }
}

export async function testSchemaOpinionAnalysis() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "opinion-analysis",
    caseId: "g1-led",
    moduleScope: "opinion-analysis",
  }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateOpinionAnalysisOutput(data.outputJson);
    log("Schema OpinionAnalysis", result.valid, result.errors.join("; "));
  } else {
    log("Schema OpinionAnalysis", false, "no outputJson");
  }
}

export async function testSchemaArgumentMapping() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "argument-analysis",
    caseId: "g1-led",
    moduleScope: "argument-mapping",
  }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateArgumentMappingOutput(data.outputJson);
    log("Schema ArgumentMapping", result.valid, result.errors.join("; "));
  } else {
    log("Schema ArgumentMapping", false, "no outputJson");
  }
}

export async function testSchemaReexamDraft() {
  const res = await postJSON("/ai/run", buildMockRequest({
    agent: "reexam-draft",
    caseId: "g1-led",
    moduleScope: "draft",
  }));
  const data = await res.json();
  if (data.ok && data.outputJson) {
    const result = validateReexamDraftOutput(data.outputJson);
    log("Schema ReexamDraft", result.valid, result.errors.join("; "));
  } else {
    log("Schema ReexamDraft", false, "no outputJson");
  }
}

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

    const hasStructureErrors = Array.isArray(data.structureErrors);
    log("Response has structureErrors field", hasStructureErrors);

    if (hasStructureErrors && data.structureErrors.length > 0) {
      log("Response structureErrors empty", false,
        `errors: ${data.structureErrors.join("; ")}`);
    } else {
      log("Response structureErrors empty", true);
    }
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

// ── Search References 验证 ──────────────────────────────────────────

export async function testSchemaSearchReferences() {
  const GEMINI_KEY = getApiKey("gemini");
  if (!GEMINI_KEY) {
    log("Schema SearchReferences", true, "skipped (no GEMINI_KEY)");
    return;
  }

  const res = await postJSON("/search-with-terms", {
    caseId: "g1-led",
    claimText: "一种LED灯具散热装置",
    features: [{ featureCode: "A", description: "散热基板" }],
    searchQueries: ["LED散热器"],
    maxResults: 5,
    mock: true,
    llmApiKey: GEMINI_KEY,
  });
  const data = await res.json();
  const result = validateSearchReferencesOutput(data);
  log("Schema SearchReferences", result.valid, result.errors.join("; "));
}
