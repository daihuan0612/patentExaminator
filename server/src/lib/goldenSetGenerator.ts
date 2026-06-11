/**
 * Golden Set Generator — 生成专利复审 RAG 质量评估集
 *
 * 从知识库中采样 chunk，调用 LLM 生成模拟审查员问题，
 * 存入 metrics_golden_set 表，用于 RAG 检索质量评估。
 */
import { randomUUID } from "node:crypto";
import { getSyncDb } from "./syncDb.js";
import { logger } from "./logger.js";
import { registry } from "../providers/registry.js";
import type { ProviderId } from "@shared/types/agents";

// ── Types ──────────────────────────────────────────────

export interface GoldenQuestion {
  id: string;
  agent: string;           // which agent this tests
  query: string;           // examiner's question
  expectedAnswer: string;  // expected answer summary
  expectedSources: string[]; // knowledge base file names
  expectedArticles: string[]; // legal article references
  category: string;        // novelty|inventive|defect|procedure|legal
  difficulty: "easy" | "medium" | "hard";
  generatedBy: string;     // which LLM generated this
}

// ── Question Categories ────────────────────────────────

interface QuestionCategory {
  category: string;
  agent: string;
  description: string;
  sampleQueries: string[];
}

const QUESTION_CATEGORIES: QuestionCategory[] = [
  {
    category: "新颖性",
    agent: "novelty",
    description: "新颖性判断 -- 单独对比、全部技术特征被公开",
    sampleQueries: [
      "如何判断一项权利要求是否具备新颖性？",
      "新颖性审查中“单独对比”原则如何适用？",
      "抵触申请的判断标准是什么？",
    ],
  },
  {
    category: "创造性",
    agent: "inventive",
    description: "创造性三步法 -- 最接近现有技术 -> 区别特征 -> 技术启示",
    sampleQueries: [
      "创造性三步法的具体步骤是什么？",
      "如何认定区别特征是否具有技术启示？",
      "预料不到的技术效果如何影响创造性判断？",
    ],
  },
  {
    category: "权利要求",
    agent: "claim-chart",
    description: "权利要求解读、特征拆解、保护范围",
    sampleQueries: [
      "权利要求应当满足哪些条件？",
      "如何进行权利要求特征拆解？",
      "功能性限定的权利要求如何理解？",
    ],
  },
  {
    category: "形式缺陷",
    agent: "defects",
    description: "说明书充分公开、权利要求清楚、支持、修改超范围",
    sampleQueries: [
      "说明书充分公开的判断标准是什么？",
      "权利要求不清楚的典型情形有哪些？",
      "修改超范围如何判断？",
    ],
  },
  {
    category: "程序",
    agent: "chat",
    description: "复审程序、期限、文件要求",
    sampleQueries: [
      "复审请求需要提交哪些文件？",
      "复审程序中申请人可以修改权利要求吗？",
      "复审决定的类型有哪些？",
    ],
  },
];

// ── LLM Providers for Generation ───────────────────────

interface LLMProviderConfig {
  providerId: ProviderId;
  apiKey: string;
  defaultModel: string;
  label: string;
}

const PROVIDER_CONFIGS: Array<{ key: keyof ApiKeys; providerId: ProviderId; defaultModel: string; label: string }> = [
  { key: "mimo", providerId: "mimo", defaultModel: "mimo-v2.5-pro", label: "MiMo" },
  { key: "deepseek", providerId: "deepseek", defaultModel: "deepseek-chat", label: "DeepSeek" },
  { key: "gemini", providerId: "gemini", defaultModel: "gemini-2.5-flash", label: "Gemini" },
];

// ── Database Helpers ───────────────────────────────────

interface ChunkRow {
  id: string;
  source_id: string;
  text: string;
  metadata: string;
}

interface SourceRow {
  id: string;
  name: string;
  type: string;
}

function createGoldenSetTable(): void {
  const db = getSyncDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_golden_set (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      agent         TEXT NOT NULL,
      query         TEXT NOT NULL,
      expected_answer TEXT NOT NULL,
      expected_sources TEXT DEFAULT '[]',
      expected_articles TEXT DEFAULT '[]',
      category      TEXT DEFAULT '',
      difficulty    TEXT DEFAULT 'medium',
      generated_by  TEXT DEFAULT ''
    )
  `);
}

function insertGoldenQuestion(q: GoldenQuestion): void {
  const db = getSyncDb();
  db.prepare(`
    INSERT OR IGNORE INTO metrics_golden_set
      (id, agent, query, expected_answer, expected_sources, expected_articles, category, difficulty, generated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    q.id,
    q.agent,
    q.query,
    q.expectedAnswer,
    JSON.stringify(q.expectedSources),
    JSON.stringify(q.expectedArticles),
    q.category,
    q.difficulty,
    q.generatedBy,
  );
}

function loadAllGoldenQuestions(): GoldenQuestion[] {
  const db = getSyncDb();
  const rows = db.prepare("SELECT * FROM metrics_golden_set ORDER BY created_at").all() as Array<{
    id: string;
    agent: string;
    query: string;
    expected_answer: string;
    expected_sources: string;
    expected_articles: string;
    category: string;
    difficulty: string;
    generated_by: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    query: r.query,
    expectedAnswer: r.expected_answer,
    expectedSources: safeParseJson(r.expected_sources, []),
    expectedArticles: safeParseJson(r.expected_articles, []),
    category: r.category,
    difficulty: r.difficulty as "easy" | "medium" | "hard",
    generatedBy: r.generated_by,
  }));
}

function safeParseJson<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

// ── Chunk Sampling ─────────────────────────────────────

/**
 * Sample chunks from the knowledge base, distributed across different source types.
 * Returns chunks with their source metadata for context.
 */
function sampleChunks(count: number): Array<{ chunk: ChunkRow; source: SourceRow }> {
  const db = getSyncDb();

  // Get all sources with chunk counts
  const sources = db.prepare("SELECT id, name, type FROM kb_sources").all() as SourceRow[];
  if (sources.length === 0) {
    logger.warn("[GoldenSet] No sources found in knowledge base");
    return [];
  }

  const results: Array<{ chunk: ChunkRow; source: SourceRow }> = [];
  const chunksPerSource = Math.max(1, Math.ceil(count / sources.length));

  for (const source of sources) {
    const chunks = db.prepare(
      "SELECT id, source_id, text, metadata FROM kb_chunks WHERE source_id = ? AND length(text) > 100 ORDER BY RANDOM() LIMIT ?"
    ).all(source.id, chunksPerSource) as ChunkRow[];

    for (const chunk of chunks) {
      results.push({ chunk, source });
    }
  }

  // Shuffle and trim to requested count
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = results[i]!;
    results[i] = results[j]!;
    results[j] = tmp;
  }

  return results.slice(0, count);
}

// ── LLM Call ───────────────────────────────────────────

interface GeneratedQuestion {
  query: string;
  expected_answer: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  expected_articles: string[];
}

function buildPrompt(text: string, fileName: string, section: string): string {
  return `你是一个专利复审评估集生成器。给定以下法律/审查文本，请生成一个专利审查员在复审工作中可能会问的问题，使得这段文本是回答该问题的最佳来源。

要求：
1. 问题必须是审查员在实际复审工作中会遇到的真实问题
2. 问题应该具体、明确，不要过于宽泛
3. 预期回答应该基于给定文本，简洁准确（100-200字）
4. 标注适用的法条
5. 分类必须是以下之一：新颖性、创造性、权利要求、形式缺陷、程序
6. 难度根据问题的专业程度判断

文本内容：
${text}

来源文件：${fileName}
所属章节：${section}

请严格输出以下 JSON 格式，不要输出其他内容：
{
  "query": "审查员问题",
  "expected_answer": "基于该文本的预期回答摘要（100-200字）",
  "category": "新颖性|创造性|权利要求|形式缺陷|程序",
  "difficulty": "easy|medium|hard",
  "expected_articles": ["第X条", "第X条第X款"]
}`;
}

async function callLLM(
  config: LLMProviderConfig,
  prompt: string,
): Promise<GeneratedQuestion | null> {
  try {
    const result = await registry.runWithFallback(
      [config.providerId],
      {
        modelId: config.defaultModel,
        messages: [
          { role: "system", content: "你是专利复审评估集生成助手。严格输出 JSON，不要输出 markdown 代码块或其他内容。" },
          { role: "user", content: prompt },
        ],
        apiKey: config.apiKey,
        temperature: 0.7,
        maxTokens: 1024,
      },
    );

    const resp = result.response;
    if (resp.error) {
      logger.warn(`[GoldenSet] LLM error from ${config.label}: ${resp.error.message}`);
      return null;
    }

    const text = resp.text.trim();
    return parseGeneratedQuestion(text);
  } catch (err) {
    logger.warn(`[GoldenSet] LLM call failed for ${config.label}: ${err}`);
    return null;
  }
}

function parseGeneratedQuestion(text: string): GeneratedQuestion | null {
  // Try direct JSON parse first
  let cleaned = text;
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return validateQuestion(parsed);
  } catch {
    // Try extracting JSON from text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return validateQuestion(parsed);
      } catch {
        // fall through
      }
    }
  }

  logger.warn(`[GoldenSet] Failed to parse LLM output as JSON: ${text.slice(0, 200)}`);
  return null;
}

function validateQuestion(parsed: Record<string, unknown>): GeneratedQuestion | null {
  const query = typeof parsed.query === "string" ? parsed.query : "";
  const expected_answer = typeof parsed.expected_answer === "string" ? parsed.expected_answer : "";
  const category = typeof parsed.category === "string" ? parsed.category : "";
  const difficulty = typeof parsed.difficulty === "string" ? parsed.difficulty : "medium";
  const expected_articles = Array.isArray(parsed.expected_articles)
    ? (parsed.expected_articles as unknown[]).filter((a): a is string => typeof a === "string")
    : [];

  if (!query || !expected_answer) {
    logger.warn("[GoldenSet] Parsed question missing required fields (query/expected_answer)");
    return null;
  }

  // Validate category
  const validCategories = ["新颖性", "创造性", "权利要求", "形式缺陷", "程序"];
  const safeCategory = validCategories.includes(category) ? category : "程序";

  // Validate difficulty
  const validDifficulties = ["easy", "medium", "hard"];
  const safeDifficulty = validDifficulties.includes(difficulty) ? difficulty as "easy" | "medium" | "hard" : "medium";

  return {
    query,
    expected_answer,
    category: safeCategory,
    difficulty: safeDifficulty,
    expected_articles,
  };
}

// ── Category Mapping ───────────────────────────────────

function findCategoryForAgent(category: string): QuestionCategory | undefined {
  return QUESTION_CATEGORIES.find((c) => c.category === category);
}

// ── Public API ─────────────────────────────────────────

export interface ApiKeys {
  mimo: string;
  deepseek: string;
  gemini: string;
}

/**
 * Generate a golden evaluation set for patent re-examination RAG quality.
 * Generates 60 questions total: 3 LLMs x 20 questions each.
 * Uses different chunks for each LLM to maximize diversity.
 * Results are stored in metrics_golden_set table.
 *
 * @param apiKeys - API keys for the three LLM providers
 * @param questionsPerProvider - Number of questions per provider (default 20)
 * @returns The generated golden questions
 */
export async function generateGoldenSet(
  apiKeys: ApiKeys,
  questionsPerProvider = 20,
): Promise<GoldenQuestion[]> {
  createGoldenSetTable();

  const totalQuestions = questionsPerProvider * PROVIDER_CONFIGS.length;
  logger.info(`[GoldenSet] Generating ${totalQuestions} questions (${questionsPerProvider} per provider x ${PROVIDER_CONFIGS.length} providers)`);

  // Sample enough chunks for all providers (each gets unique chunks)
  const allSamples = sampleChunks(totalQuestions);
  if (allSamples.length === 0) {
    logger.warn("[GoldenSet] No chunks available in knowledge base, cannot generate golden set");
    return [];
  }

  logger.info(`[GoldenSet] Sampled ${allSamples.length} chunks from knowledge base`);

  const results: GoldenQuestion[] = [];
  let sampleIndex = 0;

  for (const providerConfig of PROVIDER_CONFIGS) {
    const apiKey = apiKeys[providerConfig.key];
    if (!apiKey) {
      logger.warn(`[GoldenSet] No API key provided for ${providerConfig.label}, skipping`);
      sampleIndex += questionsPerProvider;
      continue;
    }

    const llmConfig: LLMProviderConfig = {
      providerId: providerConfig.providerId,
      apiKey,
      defaultModel: providerConfig.defaultModel,
      label: providerConfig.label,
    };

    let generated = 0;
    let attempts = 0;
    const maxAttempts = questionsPerProvider * 2; // allow some failures

    while (generated < questionsPerProvider && attempts < maxAttempts && sampleIndex < allSamples.length) {
      attempts++;
      const { chunk, source } = allSamples[sampleIndex]!;

      // Extract section info from metadata
      let section = "";
      try {
        const meta = JSON.parse(chunk.metadata) as Record<string, unknown>;
        section = typeof meta.section === "string" ? meta.section : typeof meta.heading === "string" ? meta.heading : "";
      } catch {
        section = "";
      }

      const prompt = buildPrompt(chunk.text, source.name, section);
      const generated_q = await callLLM(llmConfig, prompt);

      sampleIndex++;

      if (!generated_q) continue;

      // Find the matching category to determine the agent
      const categoryInfo = findCategoryForAgent(generated_q.category);
      const agent = categoryInfo?.agent ?? "chat";

      const goldenQuestion: GoldenQuestion = {
        id: `gs-${randomUUID().slice(0, 8)}`,
        agent,
        query: generated_q.query,
        expectedAnswer: generated_q.expected_answer,
        expectedSources: [source.name],
        expectedArticles: generated_q.expected_articles,
        category: generated_q.category,
        difficulty: generated_q.difficulty,
        generatedBy: providerConfig.label,
      };

      insertGoldenQuestion(goldenQuestion);
      results.push(goldenQuestion);
      generated++;

      logger.debug(`[GoldenSet] Generated Q${results.length}/${totalQuestions}: "${goldenQuestion.query.slice(0, 40)}..." (${providerConfig.label})`);
    }

    logger.info(`[GoldenSet] ${providerConfig.label}: generated ${generated}/${questionsPerProvider} questions`);
  }

  logger.info(`[GoldenSet] Total generated: ${results.length}/${totalQuestions} questions`);
  return results;
}

/**
 * Load the existing golden set from the database.
 * Returns empty array if no golden set has been generated.
 */
export async function getGoldenSet(): Promise<GoldenQuestion[]> {
  createGoldenSetTable();
  return loadAllGoldenQuestions();
}

/**
 * Clear the golden set table so it can be regenerated.
 */
export async function clearGoldenSet(): Promise<void> {
  const db = getSyncDb();
  db.exec("DELETE FROM metrics_golden_set");
  logger.info("[GoldenSet] Cleared golden set");
}

/**
 * Get golden set statistics.
 */
export function getGoldenSetStats(): { total: number; byCategory: Record<string, number>; byDifficulty: Record<string, number>; byProvider: Record<string, number> } {
  const db = getSyncDb();
  createGoldenSetTable();

  const total = (db.prepare("SELECT COUNT(*) as c FROM metrics_golden_set").get() as { c: number }).c;

  const categoryRows = db.prepare("SELECT category, COUNT(*) as c FROM metrics_golden_set GROUP BY category").all() as Array<{ category: string; c: number }>;
  const byCategory: Record<string, number> = {};
  for (const r of categoryRows) byCategory[r.category] = r.c;

  const difficultyRows = db.prepare("SELECT difficulty, COUNT(*) as c FROM metrics_golden_set GROUP BY difficulty").all() as Array<{ difficulty: string; c: number }>;
  const byDifficulty: Record<string, number> = {};
  for (const r of difficultyRows) byDifficulty[r.difficulty] = r.c;

  const providerRows = db.prepare("SELECT generated_by, COUNT(*) as c FROM metrics_golden_set GROUP BY generated_by").all() as Array<{ generated_by: string; c: number }>;
  const byProvider: Record<string, number> = {};
  for (const r of providerRows) byProvider[r.generated_by] = r.c;

  return { total, byCategory, byDifficulty, byProvider };
}
