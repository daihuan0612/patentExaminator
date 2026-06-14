# Offline Evaluation Metrics — 专利复审 RAG 离线评估规范

---

## 1. 目标与动机

### 1.1 为什么需要离线评估

专利复审 AI 助手的核心能力是**检索增强生成（RAG）**：从知识库和 web 搜索中检索相关信息，生成审查意见分析。

当前系统缺乏量化评估手段：
- 无法知道检索结果的排序质量（最相关的 chunk 是否排在前面）
- 无法知道生成答案是否忠实于检索上下文（是否产生幻觉）
- 无法知道来源路由是否正确（该用 KB 时用了 KB，该用 web 时用了 web）
- 无法比较不同配置（provider、model、检索参数）的优劣

**离线评估的目标**：建立一套可重复、可量化的评估体系，用固定测试集（golden set）持续监控和比较 RAG 系统质量。

### 1.2 离线评估 vs 在线评估

| 维度 | 离线评估 | 在线评估 |
|------|---------|---------|
| 数据来源 | 预构建的 golden set | 用户真实查询 |
| 执行方式 | 自动化脚本 | 用户交互 |
| 可重复性 | ✅ 完全可重复 | ❌ 每次不同 |
| 覆盖面 | 可控（按矩阵设计） | 随机（取决于用户行为） |
| 用途 | 版本发布前的质量门禁 | 线上问题发现 |

本文档定义离线评估的指标体系和实现方案。

---

## 2. 指标体系

### 2.1 指标总览

| # | 指标 | 类别 | 计算方式 | 需要 judge？ | 需要 golden set？ | 适用 sourceType |
|---|------|------|---------|-------------|------------------|----------------|
| M1 | **NDCG@K** | 检索排序 | DCG@K / IDCG@K | ❌ | ✅ relevanceGrading | kb_only |
| M2 | **Recall@K** | 检索覆盖 | relevant_in_topK / total_relevant | ❌ | ✅ relevanceGrading | kb_only |
| M3 | **KB Hit Rate** | 检索覆盖 | kb_only 题的 Recall@K | ❌ | ✅ relevanceGrading | kb_only |
| M5 | **Faithfulness** | 生成忠实度 | 2 judge → claim 支持率 → average | ✅ | ❌ reference-free | 全部 |
| M6 | **Answer Correctness** | 生成正确性 | 2 judge → 与 expectedAnswer 对比 → average | ✅ | ✅ expectedAnswer | 全部 |
| M7 | **Fact Coverage** | 生成完整性 | 2 judge → mustIncludeFacts 覆盖率 → average | ✅ | ✅ mustIncludeFacts | 全部 |
| M8 | **Article Accuracy** | 生成准确性 | expectedArticles 被引用比例 | ❌ | ✅ expectedArticles | 全部 |
| M9 | **Source Routing Accuracy** | 路由准确性 | expectedSource == 实际源 | ❌ | ✅ expectedSource | 全部 |
| M10 | **Conflict Resolution Rate** | 冲突处理 | 冲突题中正确选择权威源的比例 | ❌ | ✅ sourceType | conflict |
| M11 | **Refusal Accuracy** | 拒绝回答 | no_answer 题中正确拒绝的比例 | ❌ | ✅ sourceType | no_answer |

> **⚠️ M4 Web Hit Rate 已删除**
>
> Web 搜索是非确定性的——今天搜"专利法第二十二条"可能找到知乎文章，下个月可能找到专利局官网。
> 不存在稳定的 "relevant chunk set" 可以作为 ground truth，因此 chunk 级检索指标（NDCG/Recall）不适用于 web 搜索。
>
> **Web 搜索质量通过端到端答案质量衡量**（M6 Answer Correctness + M7 Fact Coverage + M8 Article Accuracy），
> 而非 chunk 级检索指标。这是 Copilot、Perplexity 等跨源系统的通用做法。

### 2.2 指标详细定义

#### M1: NDCG@K（检索排序质量）

**为什么选这个指标**：KB 检索返回 top-K 个 chunk，但并非所有 chunk 都相关。NDCG 考虑了排序位置——排在前面的相关 chunk 贡献更大。比单纯的 Recall 更能反映用户体验。

**公式**：
```
DCG@K = Σᵢ₌₁ᴷ (2^relᵢ - 1) / log₂(i + 1)
NDCG@K = DCG@K / IDCG@K

relᵢ = 第 i 个检索结果的 relevance grade（0-3，来自 relevanceGrading）
IDCG@K = 理想排序（按 grade 降序）的 DCG
```

**输入数据**：`relevanceGrading` 字段（chunk 级 grading，由 A.2 阶段产出）

**范围**：仅 `kb_only`（web 搜索是非确定性的，不存在稳定的 ground truth chunk 集）

---

#### M2: Recall@K（检索覆盖率）

**为什么选这个指标**：衡量关键信息是否被检索到。用户关心"答案在不在 top-K 里"。

**公式**：
```
Recall@K = (grade ≥ 2 的 chunk 中被检索到的数量) / (grade ≥ 2 的 chunk 总数)
```

**输入数据**：`relevanceGrading` 字段（grade ≥ 2 视为"相关"）

**范围**：仅 `kb_only`（同 M1）

---

#### M3: KB Hit Rate（KB 检索命中率）

**为什么选这个指标**：KB 检索质量的单一来源监控。KB Hit Rate 低说明知识库检索有问题。

**公式**：对 `kb_only` 题目计算 Recall@K

**输入数据**：`relevanceGrading` 字段 + `sourceType` 字段

**范围**：仅 `kb_only`

> **Web 搜索质量如何衡量？**
>
> Web 搜索是非确定性的，无法预计算 ground truth chunk 集。Web 搜索质量通过端到端答案质量衡量：
> - M6 Answer Correctness：答案是否正确
> - M7 Fact Coverage：关键事实是否覆盖
> - M8 Article Accuracy：法条引用是否准确
>
> 这是 Copilot、Perplexity 等跨源系统的通用做法——不通过匹配特定 URL 来衡量 web 搜索，而是通过最终答案质量来衡量。

---

#### M5: Faithfulness（生成忠实度）

**为什么选这个指标**：RAG 系统的最大风险是幻觉——生成了检索上下文中不支持的内容。Faithfulness 是 reference-free 指标，不需要参考答案，只检查生成内容是否被上下文支持。

**计算流程**：
```
1. 2 个 LLM judge 各自独立执行：
   a. 将生成的答案拆成 N 个独立 claims
   b. 对每个 claim，检查是否被检索到的上下文支持
   c. 计算该 judge 的 faithfulness = 被支持 claims / 总 claims
2. 最终 Faithfulness = 2 个 judge 的算术平均
```

**输入数据**：RAG pipeline 输出的答案 + 检索到的 chunks（评估阶段实时获取）

**不需要 golden set 字段**：这是 reference-free 指标

---

#### M6: Answer Correctness（答案正确性）

**为什么选这个指标**：Faithfulness 只检查是否忠实于上下文，但上下文本身可能是错的或不完整的。Answer Correctness 将生成答案与 golden set 中的参考答案对比。

**计算流程**：
```
1. 2 个 LLM judge 各自独立执行：
   a. 对比生成答案与 expectedAnswer
   b. 给出 0-1 的正确性分数
2. 最终 Answer Correctness = 2 个 judge 的算术平均
```

**输入数据**：RAG pipeline 输出的答案 + `expectedAnswer` 字段

---

#### M7: Fact Coverage（事实覆盖率）

**为什么选这个指标**：答案可能部分正确但遗漏关键事实。Fact Coverage 检查参考答案中的关键事实点是否被覆盖。

**计算流程**：
```
1. 2 个 LLM judge 各自独立执行：
   a. 对 mustIncludeFacts 中的每个事实点
   b. 判断生成答案是否包含该事实（语义匹配）
   c. 计算该 judge 的 fact coverage = 被覆盖数 / 总数
2. 最终 Fact Coverage = 2 个 judge 的算术平均
```

**输入数据**：RAG pipeline 输出的答案 + `mustIncludeFacts` 字段

---

#### M8: Article Accuracy（法条引用准确性）

**为什么选这个指标**：专利复审必须引用准确的法条。错误引用比不引用更危险。

**公式**：
```
Article Accuracy = 生成答案中引用的法条 ∩ expectedArticles / |expectedArticles|
```

**输入数据**：RAG pipeline 输出的答案 + `expectedArticles` 字段

**计算方式**：确定性计算，不需要 judge

---

#### M9: Source Routing Accuracy（来源路由准确性）

**为什么选这个指标**：系统需要判断答案来自 KB 还是 web，路由错误会导致检索失败。

**公式**：
```
Source Routing Accuracy = 路由正确的题目数 / 总题目数
```

**输入数据**：`expectedSource` 字段 vs RAG pipeline 实际使用的源

---

#### M10: Conflict Resolution Rate（冲突处理率）

**为什么选这个指标**：当 KB 和 web 给出矛盾答案时，系统应优先选择权威来源（KB）。

**公式**：
```
Conflict Resolution Rate = 冲突题中正确选择 KB 的数量 / 冲突题总数
```

**输入数据**：`sourceType == "conflict"` 的题目 + RAG pipeline 选择的源

---

#### M11: Refusal Accuracy（拒绝回答准确率）

**为什么选这个指标**：对于没有可靠答案的问题，系统应拒绝回答而非编造。这是防幻觉的最后一道防线。

**公式**：
```
Refusal Accuracy = no_answer 题中正确拒绝的数量 / no_answer 题总数
```

**输入数据**：`sourceType == "no_answer"` 的题目 + RAG pipeline 的回答是否表示"无法确定"

---

### 2.3 指标优先级

| 优先级 | 指标 | 适用 sourceType | 理由 |
|--------|------|----------------|------|
| **P0** | M1 NDCG@5 | kb_only | KB 检索排序是最核心的 RAG 质量指标 |
| **P0** | M5 Faithfulness | 全部 | 幻觉是最严重的质量问题 |
| **P0** | M9 Source Routing | 全部 | 路由错误直接导致检索失败 |
| **P1** | M2 Recall@10 | kb_only | KB 检索覆盖率 |
| **P1** | M3 KB Hit Rate | kb_only | KB 检索质量分源监控 |
| **P1** | M6 Answer Correctness | 全部 | 端到端答案质量（web 搜索质量的核心衡量） |
| **P1** | M7 Fact Coverage | 全部 | 关键事实遗漏 |
| **P1** | M8 Article Accuracy | 全部 | 法条引用准确性 |
| **P2** | M10 Conflict Resolution | conflict | 冲突处理能力 |
| **P2** | M11 Refusal Accuracy | no_answer | 拒绝回答能力（防幻觉最后防线） |

### 2.4 指标与 judge 的关系

| 指标类型 | judge 时机 | 说明 |
|----------|-----------|------|
| **确定性指标**（M1-M3, M8-M11） | 不需要 judge | 用 golden set 的预计算数据直接计算 |
| **语义指标**（M5, M6, M7） | 评估阶段实时调用 judge | 因为需要对比 RAG 输出和参考数据 |

> **关键区分**：judge 出现在两个不同的场景：
> 1. **A.2 阶段**：judge 对候选 KB chunks 打分，产出 `relevanceGrading`（仅 `kb_only` 题目，为 M1-M3 服务）
> 2. **D 阶段**：judge 对 RAG 输出打分，产出 Faithfulness/AnswerCorrectness/FactCoverage（为 M5-M7 服务，适用全部 sourceType）
>
> 两次 judge 的输入和目的完全不同，不可混淆。
>
> **Web 搜索不需要 A.2 阶段的 chunk 级 grading**：web 内容是动态的，无法预计算 ground truth。
> Web 搜索质量通过 D 阶段的端到端答案质量衡量（M6/M7/M8）。

---

## 3. 离线评估的成功标准

离线评估本身也需要评估——怎么证明这套指标体系是有用的？

### 3.1 成功标准

| # | 成功标准 | 验证方法 |
|---|---------|---------|
| S1 | 指标能区分好坏配置 | 用不同 provider/model 跑评估，指标应有显著差异 |
| S2 | 指标变化与用户体验一致 | 指标下降时，人工抽检确认答案质量确实下降 |
| S3 | 评估结果可重复 | 相同配置多次评估，指标方差 < 5% |
| S4 | 评估覆盖所有题型 | 5 种 sourceType × 5 个 category = 25 个 cell，至少覆盖 21 个 |
| S5 | Golden set 质量合格 | A.2 阶段 grading 后，每道 `kb_only` 题至少 1 个 grade≥2 的候选 |

### 3.2 反模式

| 反模式 | 问题 | 检测方法 |
|--------|------|---------|
| 指标无区分度 | 所有配置得分差不多 | 比较 best vs worst 配置的指标差异 |
| 指标与体验脱节 | 指标涨了但用户说更差了 | 定期人工抽检 + 用户反馈 |
| Golden set 质量差 | 题目不合理或答案错误 | A.2 阶段的质量校验 + 人工抽检 |
| Grading 循环自证 | 生成 chunk 和 grading chunk 是同一批 | A.2 必须独立采样候选集 |

---

## 4. Golden Set 数据结构

### 4.1 GoldenQuestion 字段映射

每个字段必须映射到具体的评估指标。无映射的字段应删除。

| 字段 | 类型 | 映射指标 | 产出阶段 | 说明 |
|------|------|---------|---------|------|
| `id` | string | — | A.1 | 唯一标识，不映射指标 |
| `query` | string | 所有指标 | A.1 | 评估的输入问题 |
| `category` | enum | 分组统计 | A.1 | 按 category 分组看指标 |
| `difficulty` | enum | 分组统计 | A.1 | 按 difficulty 分组看指标 |
| `sourceType` | enum | M3/M9/M10/M11 | A.1 | 决定该题评估哪些指标 |
| `agent` | string | 分组统计 | A.1 | Phase 1 固定为 "chat" |
| `expectedAnswer` | string | **M6** Answer Correctness | A.1 | RAG 输出的对比基准 |
| `mustIncludeFacts` | string[] | **M7** Fact Coverage | A.1 | 关键事实点覆盖检查 |
| `expectedArticles` | string[] | **M8** Article Accuracy | A.1 | 法条引用检查 |
| `expectedSource` | enum | **M9** Source Routing | A.1 | 路由正确性检查 |
| `sourceRoutingRationale` | string | — | A.1 | 解释为什么选这个源（辅助理解，不参与指标计算） |
| `expectedSources` | string[] | — | A.1 | 文件名/URL 列表（辅助理解，不参与指标计算） |
| `relevanceGrading` | RelevanceGrade[] | **M1/M2/M3** | A.2 | chunk 级 ground truth（仅 `kb_only`） |
| `generatedBy` | string | — | A.1 | 记录哪个 provider 生成 |
| `verifiedBy` | enum | — | A.1 | 验证方式 |

**字段删除建议**：
- `sourceRoutingRationale` 和 `expectedSources` 不直接参与指标计算，但有助于标记不可信和调试，保留。

### 4.2 RelevanceGrade 结构

```typescript
interface RelevanceGrade {
  source: "kb" | "web";       // 来源类型
  docId: string;              // 文档标识
  chunkId?: string;           // chunk 标识（KB 必填）
  grade: 0 | 1 | 2 | 3;      // 聚合后的 relevance grade
  rationale: string;          // 聚合理由
  judges?: JudgeResult[];     // 每个 judge 的独立打分
}

interface JudgeResult {
  provider: string;           // judge provider ID
  grade: 0 | 1 | 2 | 3 | null;  // null = judge 调用失败
  rationale: string;
}
```

**映射指标**：M1 NDCG@K、M2 Recall@K、M3 KB Hit Rate

**Relevance Grade 标准**（TREC/NIST）：

| Grade | 含义 | 在指标计算中的作用 |
|-------|------|-------------------|
| 0 | 不相关 | 不计入 recall，对 NDCG 贡献为 0 |
| 1 | 边际相关 | 不计入 recall（grade ≥ 2 才计入），对 NDCG 有小贡献 |
| 2 | 部分相关 | 计入 recall，对 NDCG 有中等贡献 |
| 3 | 高度相关 | 计入 recall，对 NDCG 有最大贡献 |

### 4.3 题目类型（sourceType）

| sourceType | 检索指标（chunk 级） | 答案指标（端到端） | 说明 |
|------------|-------------------|-------------------|------|
| `kb_only` | M1, M2, M3 | M5, M6, M7, M8, M9 | 纯 KB 场景：检索 + 答案都评估 |
| `web_only` | ❌ 不评估 | M5, M6, M7, M8, M9 | 纯 Web 场景：只评估端到端答案质量 |
| `cross_source` | ❌ 不评估 | M5, M6, M7, M8, M9 | 综合场景：只评估端到端答案质量 |
| `conflict` | ❌ 不评估 | M9, M10 | 冲突处理场景：评估路由 + 冲突解决 |
| `no_answer` | ❌ 不评估 | M9, M11 | 拒绝回答场景：评估拒绝准确性 |

> **为什么 web 类型不评估检索指标？**
>
> Web 搜索是非确定性的。同一问题在不同时间搜索，会得到不同的网页结果。
> 不存在稳定的 "relevant chunk set" 可以作为 ground truth，因此 chunk 级检索指标（NDCG/Recall/Hit Rate）不适用。
>
> Web 搜索质量通过端到端答案质量衡量：系统是否找到了能回答问题的信息（M6），是否覆盖了关键事实（M7），法条引用是否准确（M8）。
> 这是 Copilot、Perplexity 等跨源系统的通用做法。

### 4.4 题目类型分布矩阵

每个 provider 生成 7 题，3 provider 共 21 题。

> **硬约束**：总题数必须等于矩阵所有非零 cell 之和（21）。不符合则生成失败。

```
┌──────┬──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┬────────┐
│  行  │  sourceType  │  新颖性  │  创造性  │ 权利要求 │ 形式缺陷 │   程序   │ 行合计 │
│      │              │    C1    │    C2    │    C3    │    C4    │    C5    │        │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│  R1  │ kb_only      │ 11: 1    │ 12: 1    │ 13: 1    │ 14: 1    │ 15: 1    │   5    │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│  R2  │ web_only     │ 21: 1    │ 22: 1    │ 23: 1    │ 24: 1    │ 25: 1    │   5    │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│  R3  │ cross_source │ 31: 1    │ 32: 1    │ 33: 1    │ 34: 1    │ 35: 1    │   5    │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│  R4  │ conflict     │ 41: 1    │ 42: 1    │ 43: 1    │ 44: 0    │ 45: 0    │   3    │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│  R5  │ no_answer    │ 51: 0    │ 52: 2    │ 53: 0    │ 54: 0    │ 55: 1    │   3    │
├──────┼──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│      │ 列合计       │    3     │    5     │    3     │    3     │    5     │   21   │
└──────┴──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┴────────┘
```

---

## 5. 实现方案 — Phase 1：Chat Agent

Phase 1 评估 `chat` agent（占实际使用量 90%+）。所有题目 `agent` 字段固定为 `"chat"`。

Phase 1 分四个阶段执行：

```
┌─────────────────────────────────────────────────────────────┐
│ A.1 生成 Golden Set                                          │
│ 产出：21 题 + 参考答案（relevanceGrading 为空）                 │
│ 为指标服务：M5-M11 的输入数据                                   │
├─────────────────────────────────────────────────────────────┤
│ A.2 Relevance Grading                                        │
│ 产出：有 KB chunk 题目的 chunk 级 ground truth                 │
│ 为指标服务：M1-M3 的输入数据（kb_only + cross + conflict）      │
├─────────────────────────────────────────────────────────────┤
│ B Golden Set 质量评估                                         │
│ 产出：质量报告（题目是否合格、grading 是否可信）                  │
│ 目的：确保 golden set 本身质量达标，不产出垃圾指标                │
├─────────────────────────────────────────────────────────────┤
│ C 清理不合格题目                                               │
│ 产出：删除 B 阶段不通过的题目，保留合格题目到 DB                  │
│ 导出：golden-set-raw-{ts}.json（调试）+ golden-set-{ts}.json   │
├─────────────────────────────────────────────────────────────┤
│ D 用 Golden Set 评估模型                                      │
│ 产出：评估报告（各项指标分数）                                    │
│ 计算指标：M1-M3（kb_only）+ M5-M11（按 sourceType）            │
└─────────────────────────────────────────────────────────────┘
```

**各阶段 LLM 调用预算**：

| 阶段 | 逐题调用 | 批量合并后 | 说明 |
|------|---------|-----------|------|
| A.1 生成 | 3 | 3 | 已是批量（每 provider 1 次生成 7 题） |
| A.2 Grading | 32 | **2** | 有 KB chunk 的题目（16 题 × 1 批量 prompt × 2 judge） |
| B 质量评估 | 0 | 0 | 确定性检查，不调用 LLM |
| D RAG 生成 | 21 | 21 | 每题独立检索，不可合并 |
| D 语义指标 | 126 | **2** | M5/M6/M7 合并为 1 个 prompt × 2 judge |
| **总计** | **170** | **~28** | |

> **A.2 批量 grading**
>
> 每题 4 个候选合并为 1 个 prompt，每个 judge 只需 1 次调用即可评完所有候选。
> 16 题 × 2 judge = 32 次 LLM 调用（原来逐个候选需要 128 次）。

> **B 阶段为什么 0 次 LLM 调用？**
> B 的 10 项检查全部是确定性规则：题数计数、矩阵覆盖、字符长度、grade 分布统计、方差计算。
> 不需要 LLM 判断，用代码即可完成。

**批量合并策略**：

核心原则：**能合并的 prompt 尽量合并，减少 LLM 调用次数。**

| 阶段 | 合并方式 | 风险 |
|------|---------|------|
| A.2 | 所有候选塞进 1 个 prompt，2 judge 各调 1 次 | prompt 长（~20K tokens），judge 可能漏评。需要实现方实测 prompt 长度对打分质量的影响，必要时分批 |
| C judge | 21 题的答案+参考数据合并为 1 个 prompt，M5/M6/M7 三指标一次返回 | 同上。如果质量下降，可按 7 题一批分 3 次调用 |

**不可合并的调用**：
- D RAG 生成：每道题的 query 不同 → 检索结果不同 → 生成答案不同，存在顺序依赖，必须逐题执行

### 5.1 A.1 生成 Golden Set

**职责**：生成题目和参考答案。

**输入**：知识库 chunks、web 搜索结果
**输出**：21 道 GoldenQuestion，`relevanceGrading = []`

**流程**：

```
1. 采样阶段
   ├─ KB: sampleChunks(N) → 每个 source 均匀采样
   └─ Web: 对采样 chunk 提取关键词 → web 搜索 → top-K 结果

2. 题目生成阶段（并行，3 providers）
   ├─ 按 sourceType × category 矩阵分配（§4.4）
   ├─ 批量生成 query + expectedAnswer + metadata
   └─ 每个 provider 生成 7 题

3. 存储阶段
   └─ 写入 metrics_golden_set 表
```

**字段 → 指标映射**：

| 产出字段 | 服务的指标 | 说明 |
|---------|-----------|------|
| `query` | 所有 | 评估输入 |
| `expectedAnswer` | M6 | Answer Correctness 的对比基准 |
| `mustIncludeFacts` | M7 | Fact Coverage 的检查清单 |
| `expectedArticles` | M8 | Article Accuracy 的对比基准 |
| `expectedSource` | M9 | Source Routing 的对比基准 |
| `sourceType` | M3/M9/M10/M11 | 决定该题评估哪些指标 |
| `contextChunkIds` | A.2 | kb_only 题的正样本 chunk IDs（A.2 grading 用） |
| `relevanceGrading` | — | **此阶段留空**，由 A.2 填充（有 KB chunk 的题目） |

**Token 消耗**：~21 次 LLM 调用，~2 万 tokens

**⚠️ 不做的事**：不调用 multi-judge，不做 relevance grading。web 搜索结果是生成问题的辅助工具，不存储为 ground truth。

---

### 5.2 A.2 Relevance Grading

**职责**：为 `kb_only` 题目建立 chunk 级 ground truth 池。

**输入**：A.1 的 `kb_only` 题目（含 query）+ 独立采样的候选 KB chunks
**输出**：每道 `kb_only` 题的 `relevanceGrading` 字段（写回 DB）

> **为什么只对 `kb_only` 做 grading？**
>
> - `kb_only`：KB 内容稳定，可以预计算 ground truth chunk 集 → 支持 M1/M2/M3 检索指标
> - `web_only` / `cross_source` / `conflict`：web 内容是动态的，无法预计算 ground truth chunk 集
> - Web 搜索质量通过 D 阶段的端到端答案质量衡量（M6/M7/M8），不需要 chunk 级 grading
> - `no_answer`：设计上无好候选，不需要 grading

**为什么必须独立采样？**

A.1 生成题目时使用的 chunk 是 LLM 生成问题的上下文，天然高度相关。用它做 grading 是**循环自证**——所有生成 chunk 都会得 grade 3，对评估检索排序没有价值。

A.2 必须从知识库**独立采样**一批候选（与生成 chunk 无关），包含相关和不相关的 chunk，才能真实反映 RAG 检索的排序质量。

**流程**：

```
1. 加载 A.1 生成的所有 kb_only 题目

2. 对每道题，构建候选集（每题 1 正样本 + 3 负样本）：
   ├─ 候选 1：生成该题用的 KB chunk（正样本）
   ├─ 候选 2-4：从知识库随机采样 3 个其他 chunk（负样本）

3. 2 个 LLM judge（MiMo + DeepSeek）对每个候选独立打分（0-3）

4. 聚合：2 个 judge 取平均，四舍五入到最近整数

5. 写回 DB（更新 relevanceGrading 字段）
```

**字段 → 指标映射**：

| 产出字段 | 服务的指标 | 说明 |
|---------|-----------|------|
| `relevanceGrading[].grade` | M1, M2, M3 | NDCG/Recall 的 relᵢ |
| `relevanceGrading[].source` | M3 | KB 来源统计 |
| `relevanceGrading[].judges` | B9 Judge 一致性 | B 阶段计算 2 judge 打分差异，差异 > 2 标记为不可信 |

**Multi-Judge 配置**：

| Judge | Provider | 模型 | 用途 |
|-------|----------|------|------|
| Judge 1 | MiMo | mimo-v2.5 | A.2 + C |
| Judge 2 | 火山引擎 (DeepSeek) | deepseek-v3-2-251201 | A.2 + C |

> **为什么只用 2 个 judge？** volcengine doubao-seed 120s 超时频繁，3 judge 方案不可靠。
> 2 judge 取平均（而非 majority vote），牺牲少量精度换取稳定性。

**Judge Prompt**：

```
你是专利复审领域的评估专家。给定一个问题和一段文本，请判断该文本对回答问题的相关程度。

评分标准：
- 0分：完全不相关，内容与问题无关
- 1分：边际相关，提及了相关主题但不直接回答问题
- 2分：部分相关，包含回答问题所需的部分信息
- 3分：高度相关，直接且完整地回答了问题

问题：{query}

文本：{chunk_text}

请输出 JSON：
{
  "grade": 0|1|2|3,
  "rationale": "打分理由"
}
```

---

### 5.3 B Golden Set 质量评估

**职责**：验证 A.1 + A.2 产出的 golden set 本身质量是否达标。

**为什么需要这个阶段？**

Golden set 是所有指标的 ground truth 来源。如果 golden set 质量差（题目不合理、答案错误、grading 不可信），后续 D 阶段产出的所有指标都不可信——垃圾进，垃圾出。

B 阶段是 golden set 的"出厂质检"，确保只有合格的 golden set 才进入 D 阶段。

**输入**：A.1 + A.2 产出的完整 golden set
**输出**：质量报告（通过 / 不通过 + 具体问题清单）

**检查项**：

| # | 检查项 | 合格标准 | 适用范围 | 不合格处理 |
|---|--------|---------|---------|-----------|
| B1 | 题目数量 | 总数 == 21 | 全部 | 生成失败，重跑 A.1 |
| B2 | 矩阵覆盖 | 21 个非零 cell 全部有题 | 全部 | 生成失败，重跑 A.1 |
| B3 | query 质量 | 每题 query ≥ 20 字，不重复 | 全部 | **C 阶段删除** |
| B4 | expectedAnswer 质量 | 每题 200-500 字，引用法条 | 全部 | **C 阶段删除** |
| B5 | mustIncludeFacts | 每题 3-8 个事实点 | 全部 | **C 阶段删除** |
| B6 | relevanceGrading 非空 | 有 KB chunk 的题目至少 1 个 grading 候选 | **有 KB chunk** | 重跑 A.2 |
| B7 | Grading 分布 | 正样本不能全是 grade=0（排除 no_answer）；允许 ≤20% 失败 | **有 grading，非 no_answer** | **C 阶段删除** |
| B8 | Grading 可信度 | 每题正样本至少 1 个 grade≥1（排除 no_answer）；允许 ≤20% 失败 | **有 grading，非 no_answer** | **C 阶段删除** |
| B9 | Judge 一致性 | 2 judge 打分差异 ≤ 2 | **有 grading 数据** | **C 阶段删除** |
| B10 | 题目不重复 | 任意两题 query 语义相似度 < 0.8 | 全部 | **C 阶段删除** |

**C 阶段清理**：B 阶段检查完成后，自动删除 B3/B4/B5/B7/B8/B9/B10 不合格的题目。删除后导出两个 JSON：
- `golden-set-raw-{ts}.json`：A.2 后的原始快照（全部题目，调试用）
- `golden-set-{ts}.json`：清理后的干净版（仅合格题目，用于 D 阶段评估）

> **为什么 B6-B9 只对 `kb_only` 检查？**
>
> `web_only` / `cross_source` / `conflict` / `no_answer` 题目不做 A.2 grading（web 内容动态，无法预计算 ground truth）。
> 这些题目的质量通过 A.1 的 `expectedAnswer` / `mustIncludeFacts` / `expectedArticles` 保证（B4/B5 检查），
> 以及 C 阶段的端到端答案质量衡量（M6/M7/M8）。

**质量报告格式**：

```json
{
  "passed": true,
  "totalQuestions": 21,
  "checks": {
    "B1_count": { "passed": true, "detail": "21/21" },
    "B2_matrix": { "passed": true, "detail": "21/21 cells covered" },
    "B3_query_quality": { "passed": true, "detail": "0 issues" },
    "B7_grading_distribution": { "passed": true, "detail": "2 questions with all positive samples graded 0 (threshold: 4)", "questions": ["gs-abc123", "gs-def456"] },
    "B8_min_grade": { "passed": true, "detail": "19/21 graded questions have positive grade≥1 (threshold: 4 failures)" },
    "B9_judge_variance": { "passed": false, "detail": "3 questions with variance > 1.5", "questions": ["gs-xyz789"] }
  },
  "warnings": ["gs-abc123: expectedAnswer only 150 chars (min 200)"],
  "recommendation": "PROCEED_WITH_CAUTION — 2 checks failed, review flagged questions"
}
```

**决策规则**：
- **B1/B2 不通过** → 重跑 A.1
- **B6 不通过** → 重跑 A.2
- **其他检查不通过** → C 阶段自动删除不合格题目，保留合格题目进入 D 阶段

---

### 5.4 D 用 Golden Set 评估模型

**职责**：用含 grading 的完整 golden set 评估 RAG 系统。

**输入**：完整 golden set（含 relevanceGrading）+ 被测 RAG 配置
**输出**：评估报告（各项指标分数）

**⚠️ 关键约束：必须使用实际 app 的 RAG pipeline**

D 阶段评估的目的是 **eval app 中用户配置的模型组合和 chat query & answer 这个 feature**。
因此，必须调用实际 app 的 `runAgent()` 函数，包括：
- **多源融合**：KB 检索 + Web 搜索 → 合并重排
- **Tool calling**：web search tool、knowledge search tool
- **完整的 system prompt**：包含 web search 使用引导
- **用户配置的模型组合**：provider/model/fallback 等

❌ **绝对禁止**：
- 只用 KB 检索，不调用 web 搜索
- 使用简化版的 RAG pipeline
- 硬编码检索逻辑，绕过 orchestrator

✅ **正确做法**：
- 调用 `runAgent(agentReq)`，传递完整的 `AgentRunRequest`
- 包含 `webSearchEnabled: true`、`searchApiKey`、`knowledgeEnabled: true`
- 让 orchestrator 自行决定路由（KB/web/融合）

**流程**：

```
1. 加载 golden set（从 DB，含 relevanceGrading）

2. 对每个 golden question：
   a. 构建完整的 AgentRunRequest（包含 webSearchEnabled、searchApiKey、knowledgeEnabled 等）
   b. 调用 runAgent(agentReq) — 使用实际 app 的 RAG pipeline
   c. 记录：检索到的 chunks、生成的答案、使用的源（KB + web）

3. 计算指标：
   ┌─────────────────────────────────────────────────────┐
   │ 确定性指标（直接计算，不需要 judge）                     │
   │ ├─ M1 NDCG@K：用 relevanceGrading 的 grade 计算       │
   │ │   （仅 kb_only）                                    │
   │ ├─ M2 Recall@K：用 grade≥2 的 chunk 统计              │
   │ │   （仅 kb_only）                                    │
   │ ├─ M3 KB Hit Rate：kb_only 题的 Recall                │
   │ │   （仅 kb_only）                                    │
   │ ├─ M8 Article Accuracy：expectedArticles 对比          │
   │ │   （全部 sourceType）                                │
   │ ├─ M9 Source Routing：expectedSource 对比实际           │
   │ │   （全部 sourceType）                                │
   │ ├─ M10 Conflict Resolution：冲突题路由正确率            │
   │ │   （仅 conflict）                                    │
   │ └─ M11 Refusal Accuracy：no_answer 题拒绝率            │
   │     （仅 no_answer）                                    │
   ├─────────────────────────────────────────────────────┤
   │ 语义指标（2 judge：MiMo + DeepSeek）                     │
   │ ├─ M5 Faithfulness：2 judge → claim 支持率 → average   │
   │ │   （全部 sourceType）                                │
   │ ├─ M6 Answer Correctness：2 judge → 对比 expectedAnswer│
   │ │   （全部 sourceType）                                │
   │ └─ M7 Fact Coverage：2 judge → mustIncludeFacts 覆盖率  │
   │     （全部 sourceType）                                │
   └─────────────────────────────────────────────────────┘

4. 汇总报告 → 写入 metrics_golden_runs 表
```

**指标 → 数据源映射**：

| 指标 | 数据来源 | 适用 sourceType | 计算时机 |
|------|---------|----------------|---------|
| M1 NDCG@K | `relevanceGrading`（A.2 产出）+ RAG 检索结果 | kb_only | 评估时 |
| M2 Recall@K | `relevanceGrading`（A.2 产出）+ RAG 检索结果 | kb_only | 评估时 |
| M3 KB Hit Rate | M2 的子集（`sourceType == "kb_only"`） | kb_only | 评估时 |
| M5 Faithfulness | RAG 答案 + 检索上下文 | 全部 | 评估时（judge） |
| M6 Answer Correctness | RAG 答案 + `expectedAnswer`（A.1 产出） | 全部 | 评估时（judge） |
| M7 Fact Coverage | RAG 答案 + `mustIncludeFacts`（A.1 产出） | 全部 | 评估时（judge） |
| M8 Article Accuracy | RAG 答案 + `expectedArticles`（A.1 产出） | 全部 | 评估时 |
| M9 Source Routing | `expectedSource`（A.1 产出）+ RAG 实际源 | 全部 | 评估时 |
| M10 Conflict Resolution | `sourceType == "conflict"`（A.1 产出）+ RAG 路由 | conflict | 评估时 |
| M11 Refusal Accuracy | `sourceType == "no_answer"`（A.1 产出）+ RAG 回答 | no_answer | 评估时 |

---

## 6. 数据库 Schema

### 6.1 metrics_golden_set 表

```sql
CREATE TABLE IF NOT EXISTS metrics_golden_set (
  id                    TEXT PRIMARY KEY,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  agent                 TEXT NOT NULL,          -- Phase 1 固定 "chat"
  query                 TEXT NOT NULL,          -- 评估输入（所有指标）
  expected_answer       TEXT NOT NULL,          -- → M6 Answer Correctness
  expected_sources      TEXT DEFAULT '[]',      -- 辅助信息（不参与指标计算）
  expected_articles     TEXT DEFAULT '[]',      -- → M8 Article Accuracy
  category              TEXT DEFAULT '',        -- 分组统计
  difficulty            TEXT DEFAULT 'medium',  -- 分组统计
  generated_by          TEXT DEFAULT '',        -- 元信息

  source_type           TEXT DEFAULT 'kb_only',       -- → M3/M9/M10/M11
  expected_source       TEXT DEFAULT 'kb',            -- → M9 Source Routing
  source_routing_rationale TEXT DEFAULT '',            -- 辅助信息
  must_include_facts    TEXT DEFAULT '[]',              -- → M7 Fact Coverage
  relevance_grading     TEXT DEFAULT '[]',              -- → M1/M2/M3（A.2 填充，有 KB chunk 的题目）
  verified_by           TEXT DEFAULT 'auto'             -- 元信息
);
```

### 6.2 relevance_grading JSON 格式

```json
[
  {
    "source": "kb",
    "docId": "专利法_2020修正.txt",
    "chunkId": "chunk_9_1",
    "grade": 3,
    "rationale": "直接回答了双重申请规则",
    "judges": [
      { "provider": "mimo", "grade": 3, "rationale": "完整覆盖" },
      { "provider": "deepseek", "grade": 2, "rationale": "缺少例外情形" },
      { "provider": "volcengine-doubao", "grade": 3, "rationale": "准确引用法条" }
    ]
  }
]
```

---

## 7. 路线图

### Phase 1：Chat Agent 离线评估（当前）

| 阶段 | 状态 | 说明 |
|------|------|------|
| A.1 生成 | ✅ 已实现 | `goldenSetGenerator.ts` |
| A.2 Grading | ✅ 已实现 | `goldenSetGrading.ts` — batch grading, 2-judge |
| B 质量评估 | ✅ 已实现 | `goldenSetQuality.ts` — 10 项确定性检查 |
| C 清理 | ✅ 已实现 | `goldenSetQuality.ts` — 删除不合格题目 |
| D 评估 | ⚠️ 部分实现 | `evalRunner.ts` — 指标计算已实现，但未使用完整 RAG pipeline（缺少 web 搜索） |

**D 阶段待修复**：
- [ ] `/metrics/eval/run` 端点接受 `webSearchEnabled` 和 `searchApiKey` 参数
- [ ] `buildAgentRequest()` 传递这些参数给 `runAgent()`
- [ ] 测试脚本传递 search API key
- [ ] 验证 web_only/cross_source/conflict 题目实际使用 web 搜索

### Phase 2：非 Chat Agent 离线评估

评估非 chat agents（claim-chart、novelty、inventive 等），使用真实案件数据 `samples/led-heatsink/`。

| Agent | 输入 | 评估指标 |
|-------|------|---------|
| `claim-chart` | 权利要求 + 对比文件 | 要素覆盖率、映射准确性 |
| `novelty` | 权利要求特征 | 结论正确性、法条引用 |
| `inventive` | 权利要求特征 | 区别特征识别、结论正确性 |
| `defects` | 权利要求文本 | 缺陷召回率、精确率 |
| `interpret` | 专利全文 | 解释准确性、术语覆盖 |
| `opinion-analysis` | OA 全文 | 驳回理由识别、策略合理性 |
| `argument-analysis` | 意见陈述书 | 论点覆盖率、论据评估 |
| `reexam-draft` | 复审理由 | 理由完整性、法条引用 |

### Phase 3：持续改进

- 自动化质量检查（grade 分布、事实点数量）
- LLM 交叉验证（10% 抽检）
- Golden set 扩展（更多案件、更多技术领域）
- 在线评估 correlation 分析

---

## 8. API Key 规范

### 8.1 搜索 Provider 架构

| 搜索路径 | Provider | 用途 |
|----------|----------|------|
| **MCP Web Search** | **SerpAPI**（硬编码） | Chat Agent 运行时 web 搜索 |
| **Direct Search** | Tavily / SerpAPI / EPO（可配置） | 专利搜索面板、A.1/A.2 阶段 |

SerpAPI fallback 链：Google → Bing → Baidu（串行，快速失败，静默降级）

### 8.2 API Key 需求

| Key | 用途 | 何时必须 |
|-----|------|---------|
| LLM Key（MiMo/DeepSeek/doubao-seed） | A.1 生成 + A.2 Grading + C 评估 | 始终 |
| SerpAPI Key | MCP Web Search + A.1 生成 | web 题型场景 |
| Tavily Key | Direct Search（可选） | 仅当使用 Tavily 时 |

### 8.3 测试脚本 Key 传递

| 阶段 | API | 字段 |
|------|-----|------|
| A.1 生成 | `POST /metrics/golden-set/generate` | `searchApiKey`（SerpAPI） |
| D 评估 | `POST /metrics/eval/run` | `apiKey`（主 LLM）+ `judgeApiKeys` + `searchApiKey`（SerpAPI） |

> **⚠️ 常见错误**：传 Tavily key 作为 `searchApiKey`。应统一使用 SerpAPI key。

### 8.4 D 阶段 API 参数规范

`POST /metrics/eval/run` 必须支持以下参数：

```typescript
{
  configs: EvalConfig[],           // 被评估的模型配置
  apiKey: string,                  // 主 LLM API key
  judgeApiKeys: Record<string, string>,  // Judge API keys（MiMo + DeepSeek）
  searchApiKey?: string,           // SerpAPI key（web 搜索必须）
  webSearchEnabled?: boolean,      // 是否启用 web 搜索（默认 true）
  knowledgeEnabled?: boolean,      // 是否启用知识库（默认 true）
  knowledgeEmbedding?: {           // 知识库 embedding 配置
    baseUrl: string;
    apiKey: string;
    modelId: string;
  },
  knowledgeReranker?: {            // 知识库 reranker 配置
    baseUrl: string;
    apiKey: string;
    modelId: string;
  },
  maxConcurrency?: number,         // 并发数（默认 3）
  agentFilter?: string,            // 过滤特定 agent
  modelFallbacks?: Record<string, string[]>,  // 模型 fallback 链
  enableModelFallback?: boolean,   // 是否启用 fallback
}
```

**参数传递链路**：
```
测试脚本 → POST /metrics/eval/run → runEvaluation() → buildAgentRequest() → runAgent()
```

每个参数必须完整传递到 `runAgent()`，不能丢失。特别是：
- `searchApiKey` → `AgentRunRequest.searchApiKey`
- `webSearchEnabled` → `AgentRunRequest.webSearchEnabled`
- `knowledgeEnabled` → `AgentRunRequest.knowledgeEnabled`
