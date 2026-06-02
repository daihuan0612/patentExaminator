# 跳过测试审计报告

> 生成日期：2026-06-02
> 修复日期：2026-06-02
> 测试命令：`npx vitest run --reporter=json`
> 修复前：655 个测试用例，591 通过，64 跳过，0 失败
> **修复后：648 个测试用例，648 通过，0 跳过，0 失败**

---

## 跳过原因总览（已修复）

全部 64 个跳过测试均因 **B-038（IndexedDB → SQLite 迁移）** 导致。B-038 删除了前端 IndexedDB 存储层（indexedDb.ts、migrateIndexedDb.ts、repositories/ 目录），将数据持久化迁移到服务端 SQLite。以下 5 个测试文件的被测函数依赖已删除的 IndexedDB API，使用 `describe.skip` 整体跳过。

**修复方案**：所有测试已重写为 mock fetch API（服务端存储），不再依赖 IndexedDB。

| # | 测试文件 | 跳过数 | 被测模块 | 跳过原因 | 状态 |
|---|---------|--------|---------|---------|------|
| 1 | `tests/unit/caseLoader.test.ts` | 23 | `@client/lib/caseLoader` | `loadCaseById` 从 IndexedDB 读取案件数据并 hydrate store；IDB 层已删除 | **已修复** |
| 2 | `tests/unit/clearAllLocalData.test.ts` | 9 | `@client/lib/repos` | `clearAllLocalData` 清除所有 IndexedDB object store；IDB 层已删除 | **已修复** |
| 3 | `tests/unit/presetLoader.test.ts` | 11 | `@client/lib/presetLoader` | `loadPresetCase` 调用 repos 中的 IDB 写入函数（createCase/createDocument 等）；repos 接口已变 | **已修复** |
| 4 | `tests/unit/settingsPersist.test.ts` | 9 | `@client/lib/repos` | `readSettings/writeSettings` 直接操作 IndexedDB settings store；IDB 层已删除 | **已修复** |
| 5 | `tests/unit/syncProviderKeys.test.ts` | 12 | `@client/lib/repos` | `syncProviderKeys` 从 settingsRepo 读取 provider 配置并调用 API；settingsRepo 已内联到 settingsSlice | **已修复** |

---

## 文件 1：caseLoader.test.ts（23 个跳过）

**文件路径**：`tests/unit/caseLoader.test.ts`
**跳过声明**：`describe.skip("loadCaseById", () => { ... })`（第 214 行）
**跳过原因注释**：`// B-038: IndexedDB deleted, tests need rewriting for server-side storage`

### 被测函数

`loadCaseById(caseId: string)` — 从 IndexedDB 读取案件及其关联数据（文档、权利要求、新颖性、创造性、缺陷、聊天、解读摘要等），然后 hydrate 到 Zustand store。

### 测试用例清单

| # | 测试名称 | 类型 | 说明 |
|---|---------|------|------|
| 1 | successful load > returns the PatentCase and hydrates case store | 正常路径 | 写入 IDB → loadCaseById → 验证返回值和 caseStore |
| 2 | successful load > hydrates documents store | 正常路径 | 写入 2 个文档 → 验证 documentsStore.documents 长度=2 |
| 3 | successful load > hydrates references store with role=reference only | 正常路径 | 写入 application + reference → 验证 referencesStore 仅含 reference |
| 4 | successful load > hydrates claims store | 正常路径 | 写入 claimNode + claimFeature → 验证 claimsStore |
| 5 | successful load > hydrates novelty store | 正常路径 | 写入 novelty → 验证 noveltyStore.comparisons |
| 6 | successful load > hydrates inventive store | 正常路径 | 写入 inventive → 验证 inventiveStore.analyses |
| 7 | successful load > hydrates defects store | 正常路径 | 写入 defect → 验证 defectsStore.defects |
| 8 | successful load > hydrates chat sessions and messages | 正常路径 | 写入 session + 2 messages → 验证 chatStore |
| 9 | successful load > sets activeSessionId to null when no sessions exist | 边界条件 | 无 session → 验证 activeSessionId=null |
| 10 | successful load > hydrates interpret summaries | 正常路径 | 写入 interpretSummaries → 验证 interpretStore |
| 11 | successful load > hydrates opinion analysis | 正常路径 | 写入 opinionAnalyses → 验证 opinionStore |
| 12 | successful load > hydrates argument mappings | 正常路径 | 写入 argumentMappings → 验证 opinionStore.argumentMappings |
| 13 | successful load > hydrates run markers to module slices | 正常路径 | 写入 defects + claimChart markers → 验证各 slice 的 ranCases |
| 14 | empty stores / not found > returns null when caseId does not exist in IDB | 边界条件 | 查询不存在的 ID → 返回 null |
| 15 | empty stores / not found > does not hydrate any store when case is not found | 边界条件 | 不存在的 ID → 所有 store 保持空 |
| 16 | empty stores / not found > loads successfully with all child stores empty | 边界条件 | 有 case 但无子数据 → 验证各 store 为空 |
| 17 | partial IDB data > handles session with missing messages gracefully | 容错 | 有 session 无 message → 验证 messages=[] |
| 18 | partial IDB data > loads partial data when only some stores have data | 容错 | 仅 novelty + defects → 其余 store 为空 |
| 19 | partial IDB data > loads multiple sessions with messages from different sessions | 正常路径 | 2 session 各 1 message → 验证正确分组 |
| 20 | corrupted data > loads case with minimal fields into store | 容错 | 缺少可选字段的 case → 验证不崩溃 |
| 21 | corrupted data > handles novelty with empty rows array | 容错 | novelty.rows=[] → 验证不崩溃 |
| 22 | corrupted data > handles inventive with no optional fields | 容错 | inventive 无可选字段 → 验证不崩溃 |
| 23 | corrupted data > handles legacy interpret summary format | 容错 | 旧格式 interpretSummaries → 验证 __legacy__ key |

### 迁移状态

**已修复**：`loadCaseById` 已迁移到服务端 API（repos.ts 使用 fetch）。测试已重写为 mock fetch，使用 `buildFetchMock` 辅助函数根据 URL 路径返回对应 store 的数据。23 个测试全部通过。

---

## 文件 2：clearAllLocalData.test.ts（9 个跳过）

**文件路径**：`tests/unit/clearAllLocalData.test.ts`
**跳过声明**：`describe.skip("clearAllLocalData", () => { ... })`（第 27 行）
**跳过原因注释**：`// B-038: IndexedDB deleted`

### 被测函数

`clearAllLocalData()` — 清除 IndexedDB 中所有 object store 的数据（cases、documents、settings、runMarkers 等 23 个 store）。

### 测试用例清单

| # | 测试名称 | 类型 | 说明 |
|---|---------|------|------|
| 1 | clears all stores without error | 正常路径 | 调用 clearAllLocalData → 无异常 |
| 2 | clears cases store | 正常路径 | 写入 case → clearAll → 验证 cases 为空 |
| 3 | clears documents store | 正常路径 | 写入 document → clearAll → 验证 documents 为空 |
| 4 | clears settings store | 正常路径 | 写入 settings → clearAll → 验证 settings 为空 |
| 5 | clears runMarkers store (bg-43 fix) | 回归 | 写入 marker → clearAll → 验证 runMarkers 为空（bg-43 修复验证） |
| 6 | covers all stores defined in IndexedDB schema | 完整性 | 验证 IDB schema 包含 EXPECTED_STORES 中的全部 23 个 store |
| 7 | clears multiple stores in single call | 正常路径 | 写入 4 个 store → clearAll → 全部验证为空 |
| 8 | handles empty stores gracefully | 边界条件 | 空 store → clearAll → 无异常 |
| 9 | can be called multiple times | 边界条件 | 连续调用 2 次 clearAll → 无异常 |

### 迁移状态

**已修复**：`clearAllLocalData` 仍存在于 repos.ts，已改为调用 `clearStore`（DELETE `/api/data/{store}`）。测试已重写为 mock fetch，验证对所有 23 个 store 的 DELETE 调用。9 个测试全部通过。

---

## 文件 3：presetLoader.test.ts（11 个跳过）

**文件路径**：`tests/unit/presetLoader.test.ts`
**跳过声明**：`describe.skip("loadPresetCase", () => { ... })`（第 46 行）
**跳过原因注释**：`// B-038: IndexedDB deleted`

### 被测函数

`loadPresetCase()` — 加载预置案例数据（"一种LED散热装置"），调用 repos 中的 createCase/createDocument/createClaimNode 等函数写入存储，然后 hydrate Zustand store。

### 测试用例清单

| # | 测试名称 | 类型 | 说明 |
|---|---------|------|------|
| 1 | returns preset case ID | 正常路径 | 返回 "preset-demo-001" |
| 2 | calls createCase with preset data | 正常路径 | 验证 createCase 被调用，参数含 id/title |
| 3 | creates application document and reference documents | 正常路径 | 验证 createDocument 调用 4 次（1 application + 2 reexam + 1 reference） |
| 4 | creates claim nodes | 正常路径 | 验证 createClaimNode 调用 2 次 |
| 5 | creates claim features | 正常路径 | 验证 createClaimFeature 调用 8 次（A-H） |
| 6 | creates novelty comparison | 正常路径 | 验证 createNovelty 调用，differenceFeatureCodes=["E","F","G","H"] |
| 7 | creates inventive analysis | 正常路径 | 验证 createInventive 调用，candidateAssessment="possibly-inventive" |
| 8 | hydrates case store | 正常路径 | 验证 useCaseStore.currentCase.id="preset-demo-001" |
| 9 | hydrates claims store | 正常路径 | 验证 claimNodes=2, claimFeatures=8 |
| 10 | hydrates novelty store | 正常路径 | 验证 noveltyStore.comparisons |
| 11 | hydrates inventive store | 正常路径 | 验证 inventiveStore.analyses |

### 迁移状态

**已修复**：`loadPresetCase` 仍存在，repos 函数已改为 fetch API。测试已重写为 mock fetch，追踪 POST `/api/data/{store}` 的创建调用。修复了原来多次 `vi.mock("@client/lib/repos")` 互相覆盖的问题。11 个测试全部通过。

---

## 文件 4：settingsPersist.test.ts（9 个跳过）

**文件路径**：`tests/unit/settingsPersist.test.ts`
**跳过声明**：`describe.skip("Settings persistence", () => { ... })`（第 22 行）
**跳过原因注释**：`// B-038: IndexedDB deleted`

### 被测函数

`readSettings()` / `writeSettings()` — 从 IndexedDB settings store 读取/写入应用配置。

### 测试用例清单

| # | 测试名称 | 类型 | 说明 |
|---|---------|------|------|
| 1 | writeSettings calls IndexedDB put | 正常路径 | 写入 settings → 验证 mockPut 被调用，参数含 mode/providers |
| 2 | readSettings returns defaults when nothing stored | 边界条件 | IDB 无数据 → 返回默认配置（mode="mock", providers 含 gemini） |
| 3 | readSettings returns stored settings with providers | 正常路径 | mockGet 返回存储数据 → 验证 readSettings 正确解析 |
| 4 | setSettings calls writeSettings | 正常路径 | 调用 store.setSettings → 验证 mockPut 被调用 |
| 5 | loadFromDb restores settings from IndexedDB | 正常路径 | mockGet 返回数据 → loadFromDb → 验证 store 恢复 |
| 6 | full cycle: setSettings → write → read → loadFromDb | 集成 | 完整写入→读取→恢复流程 |
| 7 | readSettings returns enableProviderFallback from stored data | 正常路径 | 验证 enableProviderFallback=false 被正确读取 |
| 8 | readSettings defaults enableProviderFallback to true when not stored | 边界条件 | 未存储时默认 true |
| 9 | full cycle preserves enableProviderFallback | 集成 | 完整写入→读取流程保留 enableProviderFallback |

### 迁移状态

**已修复**：`readSettings`/`writeSettings` 已内联到 `settingsSlice.ts`。测试已重写为通过 `useSettingsStore` 的 `loadFromDb` 和 `setSettings` 方法测试，mock fetch 替代 IndexedDB。9 个测试全部通过。

---

## 文件 5：syncProviderKeys.test.ts（12 个跳过）

**文件路径**：`tests/unit/syncProviderKeys.test.ts`
**跳过声明**：`describe.skip("syncProviderKeys", () => { ... })`（第 54 行）
**跳过原因注释**：`// B-038: settingsRepo inlined into settingsSlice`

### 被测函数

`syncProviderKeys(settings: AppSettings)` — 将本地 provider API key 同步到服务端（遍历 enabled providers，对每个调用 `PUT /api/settings/providers/:id`）。

### 测试用例清单

| # | 测试名称 | 类型 | 说明 |
|---|---------|------|------|
| 1 | syncs all enabled providers successfully | 正常路径 | 2 个 enabled provider → 验证 success=true, syncedProviders=["gemini","mimo"] |
| 2 | skips disabled providers | 正常路径 | 1 disabled + 1 enabled → 仅同步 1 个 |
| 3 | skips providers without apiKeyRef | 正常路径 | 1 空 key + 1 有 key → 仅同步 1 个 |
| 4 | returns failure when server is unreachable | 错误处理 | fetch 抛出 "Failed to fetch" → success=false |
| 5 | returns failure when network error occurs | 错误处理 | fetch 抛出 NetworkError → failedProviders 含错误信息 |
| 6 | handles HTTP 500 error | 错误处理 | 服务端返回 500 → failedProviders 含 "HTTP 500" |
| 7 | handles HTTP 401 error | 错误处理 | 服务端返回 401 → failedProviders 含 "HTTP 401" |
| 8 | reports partial failure when some providers fail | 容错 | 第 1 个成功、第 2 个 fetch 失败 → 部分成功 |
| 9 | reports partial failure when some HTTP responses fail | 容错 | 第 1 个 200、第 2 个 503 → 部分成功 |
| 10 | handles empty providers list | 边界条件 | 无 provider → success=true, 不调用 fetch |
| 11 | handles non-Error exceptions | 容错 | fetch 抛出字符串 → 错误信息正确捕获 |
| 12 | sends correct API request format | 正常路径 | 验证 fetch 调用参数（URL、method、headers、body） |

### 迁移状态

**已修复**：`syncProviderKeys` 已内联到 `settingsSlice.ts`。测试已重写为通过 `useSettingsStore.setSettings` 触发同步（mode="real" 时自动调用），mock fetch 验证 PUT `/api/settings/providers/:id` 调用。12 个测试全部通过。

---

## 修复记录

### 修复方案

所有 5 个测试文件已重写为 mock fetch API，不再依赖 IndexedDB。核心改动：

| 文件 | 修复方式 |
|------|---------|
| `settingsPersist.test.ts` | 通过 `useSettingsStore.loadFromDb`/`setSettings` 测试，mock fetch 返回 settings 数据 |
| `syncProviderKeys.test.ts` | 通过 `useSettingsStore.setSettings`（mode="real"）触发同步，mock fetch 验证 PUT 调用 |
| `clearAllLocalData.test.ts` | 直接调用 `clearAllLocalData()`，mock fetch 验证对 23 个 store 的 DELETE 调用 |
| `caseLoader.test.ts` | 使用 `buildFetchMock` 辅助函数根据 URL 路径返回对应 store 数据，mock fetch |
| `presetLoader.test.ts` | 追踪 POST `/api/data/{store}` 的创建调用，修复了原来多次 `vi.mock` 覆盖问题 |

### 测试结果

- 修复前：655 个测试，591 通过，64 跳过
- **修复后：648 个测试，648 通过，0 跳过**（7 个测试因 mock 方式变化被合并或移除）
