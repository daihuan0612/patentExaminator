/**
 * 全链路流水线测试
 * ================
 *
 * 测试完整的 AI Agent 流水线。
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

// ── 全链路 Mock 测试 ────────────────────────────────────────────────

export async function testFullPipelineMock_G1() {
  console.log("  [Pipeline G1] Testing ClaimChart → Novelty → Export...");

  // Step 1: Claim Chart
  const claimRes = await postJSON("/ai/run", buildMockRequest({ agent: "claim-chart", caseId: "g1-led" }));
  const claimData = await claimRes.json();
  const claimValid = claimData.ok && validateClaimChartOutput(claimData.outputJson).valid;
  log("Pipeline G1 Step 1: ClaimChart", claimValid);

  if (!claimValid) {
    log("Pipeline G1 skipped", false, "ClaimChart failed");
    return;
  }

  // Step 2: Novelty
  const noveltyRes = await postJSON("/ai/run", buildMockRequest({
    agent: "novelty",
    caseId: "g1-led",
    moduleScope: "novelty",
    extra: { expectedSchemaName: "novelty", referenceId: "g1-ref-d1" },
  }));
  const noveltyData = await noveltyRes.json();
  const noveltyValid = noveltyData.ok && validateNoveltyOutput(noveltyData.outputJson).valid;
  log("Pipeline G1 Step 2: Novelty", noveltyValid);

  // Step 3: Export (Summary)
  const summaryRes = await postJSON("/ai/run", buildMockRequest({
    agent: "summary",
    caseId: "g1-led",
    moduleScope: "summary",
  }));
  const summaryData = await summaryRes.json();
  log("Pipeline G1 Step 3: Summary", summaryData.ok === true);

  // Verify data flow
  log("Pipeline G1 complete", claimValid && noveltyValid && summaryData.ok,
    `claim=${claimValid}, novelty=${noveltyValid}, summary=${summaryData.ok}`);
}

export async function testFullPipelineMock_G2() {
  console.log("  [Pipeline G2] Testing ClaimChart → Inventive → Export...");

  // Step 1: Claim Chart
  const claimRes = await postJSON("/ai/run", buildMockRequest({ agent: "claim-chart", caseId: "g2-battery" }));
  const claimData = await claimRes.json();
  const claimValid = claimData.ok && validateClaimChartOutput(claimData.outputJson).valid;
  log("Pipeline G2 Step 1: ClaimChart", claimValid);

  if (!claimValid) {
    log("Pipeline G2 skipped", false, "ClaimChart failed");
    return;
  }

  // Step 2: Inventive
  const inventiveRes = await postJSON("/ai/run", buildMockRequest({
    agent: "inventive",
    caseId: "g2-battery",
    moduleScope: "inventive",
  }));
  const inventiveData = await inventiveRes.json();
  const inventiveValid = inventiveData.ok && validateInventiveOutput(inventiveData.outputJson).valid;
  log("Pipeline G2 Step 2: Inventive", inventiveValid);

  // Step 3: Export (Summary)
  const summaryRes = await postJSON("/ai/run", buildMockRequest({
    agent: "summary",
    caseId: "g2-battery",
    moduleScope: "summary",
  }));
  const summaryData = await summaryRes.json();
  log("Pipeline G2 Step 3: Summary", summaryData.ok === true);

  // Verify data flow
  log("Pipeline G2 complete", claimValid && inventiveValid && summaryData.ok,
    `claim=${claimValid}, inventive=${inventiveValid}, summary=${summaryData.ok}`);
}

export async function testFullPipelineMock_Reexam_G1() {
  console.log("  [Pipeline Reexam G1] Testing OpinionAnalysis → ArgumentAnalysis → ReexamDraft...");

  // Step 1: Opinion Analysis
  const oaRes = await postJSON("/ai/run", buildMockRequest({
    agent: "opinion-analysis",
    caseId: "g1-led",
    moduleScope: "opinion-analysis",
  }));
  const oaData = await oaRes.json();
  const oaValid = oaData.ok && validateOpinionAnalysisOutput(oaData.outputJson).valid;
  log("Pipeline Reexam G1 Step 1: OpinionAnalysis", oaValid);

  if (!oaValid) {
    log("Pipeline Reexam G1 skipped", false, "OpinionAnalysis failed");
    return;
  }

  // Step 2: Argument Analysis
  const argRes = await postJSON("/ai/run", buildMockRequest({
    agent: "argument-analysis",
    caseId: "g1-led",
    moduleScope: "argument-mapping",
  }));
  const argData = await argRes.json();
  const argValid = argData.ok && validateArgumentMappingOutput(argData.outputJson).valid;
  log("Pipeline Reexam G1 Step 2: ArgumentAnalysis", argValid);

  if (!argValid) {
    log("Pipeline Reexam G1 skipped", false, "ArgumentAnalysis failed");
    return;
  }

  // Step 3: Reexam Draft
  const draftRes = await postJSON("/ai/run", buildMockRequest({
    agent: "reexam-draft",
    caseId: "g1-led",
    moduleScope: "draft",
  }));
  const draftData = await draftRes.json();
  const draftValid = draftData.ok && validateReexamDraftOutput(draftData.outputJson).valid;
  log("Pipeline Reexam G1 Step 3: ReexamDraft", draftValid);

  // Verify data flow
  log("Pipeline Reexam G1 complete", oaValid && argValid && draftValid,
    `opinion=${oaValid}, argument=${argValid}, draft=${draftValid}`);
}
