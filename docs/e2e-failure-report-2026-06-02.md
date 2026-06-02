# E2E 预存失败用例详情

> 日期：2026-06-02 | 关联 commit：dc482cb (B-038 Phase 3) | 总计 233 用例，228 通过，5 失败

---

## FAILURE 1: MalformedResponse unknown fixture returns error

- **测试文件**：`tests/e2e-real.mjs:1616`
- **失败类型**：断言失败

**输入**：
```json
POST /ai/run
{
  "agent": "claim-chart",
  "providerPreference": ["gemini"],
  "modelId": "mock",
  "prompt": "Respond with plain text only: Hello World. Do NOT output JSON.",
  "sanitized": false,
  "mock": true,
  "metadata": { "caseId": "nonexistent-case-999", "moduleScope": "claim-chart", "tokenEstimate": 0 }
}
```

**预期结果**：`data.ok === false`，`data.error.code` 有值（服务端应对未知 fixture 返回错误）

**实际结果**：`data.ok === true`，`code=undefined`

**错误日志**：
```
[FAIL] MalformedResponse unknown fixture returns error - ok=true, code=undefined
       at: at testMalformedResponseHandling (file:///.../tests/e2e-real.mjs:1616:3)
```

**根因**：服务端 mock handler 在 `mock: true` 模式下未校验 fixture 有效性，对未知 fixture 仍返回 `ok: true`。

---

## FAILURE 2: DB Logic-Chain Tests（23 个子用例全失败）

- **测试文件**：`tests/integration/dbLogicChain.test.ts`（由 `e2e-real.mjs:381` 触发）
- **失败类型**：基础设施错误

**23 个子用例清单**：

| # | 用例名 |
|---|--------|
| 1 | Case logic chain > create: Store.setCases -> Repo.createCase -> DB readback |
| 2 | Case logic chain > update: Store.setCases -> Repo.updateCase -> DB readback |
| 3 | Case logic chain > delete: Store.setCases([]) -> Repo.deleteCase -> DB disappears |
| 4 | Document logic chain > create: Store.addDocument -> Repo.createDocument -> DB readback |
| 5 | Document logic chain > update: Store.updateDocument -> Repo.updateDocument -> DB readback |
| 6 | Document logic chain > delete -> Store + DB simultaneously disappear |
| 7 | Claim logic chain > claimNode: Store.setClaimNodes -> Repo.createClaimNode -> DB readback |
| 8 | Claim logic chain > claimNode: delete then Store and DB both empty |
| 9 | Claim logic chain > claimFeature: Store.addClaimFeature -> Repo.createClaimFeature -> DB readback |
| 10 | Claim logic chain > claimFeature: update citationStatus -> Store + DB consistent |
| 11 | Novelty logic chain > create: Store.addComparison -> Repo.createNovelty -> DB readback |
| 12 | Novelty logic chain > update: modify rows then Store + DB consistent |
| 13 | Novelty logic chain > delete: Store.removeComparison -> Repo.deleteNovelty -> DB disappears |
| 14 | Inventive logic chain > create: Store.addAnalysis -> Repo.createInventive -> DB readback |
| 15 | Inventive logic chain > update: modify examinerResponse + motivationEvidence -> Store + DB consistent |
| 16 | Defect logic chain > create: Store.addDefect -> Repo.createDefect -> DB readback |
| 17 | Defect logic chain > update: edit description + severity -> Store + DB consistent |
| 18 | Defect logic chain > delete: Store.removeDefect -> DB disappears |
| 19 | Chat logic chain > session: Store.addSession -> Repo.createSession -> DB readback |
| 20 | Chat logic chain > message: Store.addMessage -> Repo.createMessage -> DB readback |
| 21 | Chat logic chain > cascade: delete session -> messages also cleared |
| 22 | Feedback logic chain > create -> read -> update -> delete full lifecycle |
| 23 | Settings logic chain > read defaults -> write -> read back verification |

**输入**：每个子用例在 `beforeEach` 中调用 `openPatentDB()`（`dbLogicChain.test.ts:44`）

**预期结果**：IndexedDB 正常打开，Store -> Repo -> DB 写入 -> DB 回读链路正确

**实际结果**：`openPatentDB()` 立即抛出异常

**错误日志**：
```
Error: IndexedDB deleted in B-038 — tests need rewriting for server-side storage
  ❯ openPatentDB client/src/lib/repos.ts:543:9
      541|
      542| export async function openPatentDB(): Promise<unknown> {
      543|   throw new Error("IndexedDB deleted in B-038 — tests need rewriting f…
         |        ^
      544| }
  ❯ tests/integration/dbLogicChain.test.ts:44:20

Test Files  1 failed (1)
      Tests  23 failed (23)
```

**根因**：B-038 移除 IndexedDB 后，`openPatentDB()` 被替换为始终抛异常的 stub。这 23 个集成测试是为旧的 IndexedDB 架构编写的，需要重写为调用服务端 API。

---

## FAILURE 3: DB Scenario Tests（11 个子用例全失败）

- **测试文件**：`tests/integration/dbScenario.test.ts`（由 `e2e-real.mjs:396` 触发）
- **失败类型**：基础设施错误

**11 个子用例清单**：

| # | 用例名 | 关联 Bug |
|---|--------|---------|
| 1 | Delete reference and reload > delete ref A -> verify Store/DB both gone -> re-add ref A | Bug 18 |
| 2 | Delete reference and reload > after deleting ref -> novelty comparisons independently operable | Bug 18 |
| 3 | Delete reference and reload > multiple delete-recreate cycles Store/DB consistent | Bug 18 |
| 4 | Cascade cleanup sync > delete Case -> Chat sessions/messages cleared in Store and DB | Bug 19 |
| 5 | Cascade cleanup sync > recreating entities with same ID should not conflict | Bug 19 |
| 6 | Save then readback > write all Case fields -> DB readback -> fields match | Bug 21 |
| 7 | Save then readback > Reference field integrity: all fields write/read consistent | Bug 21 |
| 8 | Save then readback > Novelty rows complex object write/read consistency | Bug 21 |
| 9 | Defect CRUD integrity > create defect -> store to DB -> readback verify | Bug 22 |
| 10 | Defect CRUD integrity > update defect -> Store + DB sync | Bug 22 |
| 11 | Defect CRUD integrity > batch defects: create multiple -> delete one -> others present | Bug 22 |

**输入**：每个子用例在 `beforeEach` 中调用 `openPatentDB()`（`dbScenario.test.ts:39`）

**预期结果**：IndexedDB 操作成功，Bug 18/19/21/22 回归场景通过

**实际结果**：`openPatentDB()` 立即抛出异常

**错误日志**：
```
Error: IndexedDB deleted in B-038 — tests need rewriting for server-side storage
  ❯ openPatentDB client/src/lib/repos.ts:543:9
  ❯ tests/integration/dbScenario.test.ts:39:20

Test Files  1 failed (1)
      Tests  11 failed (11)
```

**根因**：同 FAILURE 2，IndexedDB stub 抛异常。

---

## FAILURE 4: DB Upgrade Tests（6/7 子用例失败，1 通过）

- **测试文件**：`tests/integration/dbUpgrade.test.ts`（由 `e2e-real.mjs:411` 触发）
- **失败类型**：基础设施错误

**7 个子用例清单**：

| # | 用例名 | 行号 | 结果 |
|---|--------|------|------|
| 1 | Store integrity > should have all expected stores in v7 schema | :81 | ❌ |
| 2 | Store integrity > should have expected indexes on all stores | :98 | ❌ |
| 3 | chatMessages schema > should have by-sessionId index | :132 | ❌ |
| 4 | chatMessages schema > should query messages by sessionId via index | :153 | ❌ |
| 5 | data integrity > should preserve case data through DB operations | :173 | ❌ |
| 6 | data integrity > should preserve chat session and message data | — | ❌ |
| 7 | （未调用 openPatentDB 的辅助测试）| — | ✅ |

**输入**：每个子用例在 `beforeEach` 中调用 `openPatentDB()`

**预期结果**：IndexedDB v7 schema 正常打开，所有 store、索引、数据完整性检查通过

**实际结果**：`openPatentDB()` 立即抛出异常

**错误日志**：
```
Error: IndexedDB deleted in B-038 — tests need rewriting for server-side storage
  ❯ openPatentDB client/src/lib/repos.ts:543:9
  ❯ tests/integration/dbUpgrade.test.ts:81:24

Test Files  1 failed (1)
      Tests  6 failed | 1 passed (7)
```

**根因**：同 FAILURE 2/3，IndexedDB stub 抛异常。

---

## FAILURE 5: EPO real search candidates non-empty

- **测试文件**：`tests/e2e-real.mjs:2383`（由 `e2e-real.mjs:2824` 触发）
- **失败类型**：Provider 不可用

**输入**：
```json
POST /search-references
{
  "caseId": "g1-led-epo",
  "claimText": "一种LED散热装置，包括散热基板和多个散热翅片。",
  "features": [{ "featureCode": "A", "description": "LED散热装置" }],
  "maxResults": 3,
  "searchProviderId": "epo",
  "searchApiKey": "<EPO_CONSUMER_KEY>:<EPO_CONSUMER_SECRET>",
  "providerPreference": ["gemini"],
  "modelId": "gemini-3.1-flash-lite-preview",
  "llmApiKey": "<GEMINI_KEY>"
}
```

**预期结果**：`data.ok === true` 且 `data.candidates.length > 0`

**实际结果**：`data.ok === false`，`candidates=0`，错误信息："AI 提取检索词失败，请稍后重试。"

**错误日志**：
```
[Real ClaimChart G1] MiMo failed: All providers failed: mimo(network-error) x12, falling back to Gemini
[FAIL] EPO real search ok - ok=false, candidates=0
       at: at testEpoSearchWithEnv (file:///.../tests/e2e-real.mjs:2383:5)
[PASS] EPO real search error info - AI 提取检索词失败，请稍后重试。
```

**根因**：EPO 搜索流程需要 LLM 先提取检索词再查询 EPO OPS。LLM 步骤失败：
1. MiMo provider：12 次重试全部 `network-error`（API 不可达）
2. Gemini fallback：HTTP 401 Unauthorized（`GEMINI_KEY` 过期或无效）

EPO key 验证本身通过（`ok=true, msg=EPO OPS Consumer Key/Secret 有效`），凭据有效，但 LLM 不可用导致检索词提取失败。

---

## 汇总

| # | 测试名称 | 失败类型 | 根因 | 修复方案 |
|---|---------|---------|------|---------|
| 1 | MalformedResponse unknown fixture | 断言失败 | mock handler 未校验 fixture 有效性 | 服务端 mock handler 需对未知 fixture 返回错误 |
| 2 | DB Logic-Chain (23 tests) | 基础设施错误 | `openPatentDB()` stub 抛异常 | 重写为服务端 API 测试 |
| 3 | DB Scenario (11 tests) | 基础设施错误 | 同上 | 重写为服务端 API 测试 |
| 4 | DB Upgrade (6/7 tests) | 基础设施错误 | 同上 | 重写为服务端 API 测试 |
| 5 | EPO search candidates | Provider 不可用 | MiMo 不可达 + Gemini 401 | 更新 GEMINI_KEY 或修复 MiMo 网络 |
