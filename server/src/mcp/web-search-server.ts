/**
 * NF1: Web Search MCP Server
 *
 * 暴露 web_search tool，使用 Tavily 搜索引擎。
 * 通过 stdio transport 与 MCP client 通信。
 *
 * 注意：日志必须走 stderr（stdout 被 JSON-RPC 占用）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";

const TAVILY_BASE = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 30_000;

// 从数据库读取 Tavily key（MCP server 自己管理 key，不依赖外部传入）
function readSearchApiKey(): string | undefined {
  try {
    const dbPath = process.env.DB_PATH;
    if (!dbPath) {
      stderrLog("DB_PATH environment variable not set");
      return undefined;
    }
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT data FROM sync_data WHERE store_name = 'settings' AND record_id = 'app'").get() as { data: string } | undefined;
    db.close();
    if (row) {
      const settings = JSON.parse(row.data) as { searchProviders?: Array<{ providerId: string; enabled: boolean; apiKeyRef: string }> };
      const provider = settings.searchProviders?.find((p) => p.providerId === "tavily" && p.enabled && p.apiKeyRef);
      return provider?.apiKeyRef;
    }
  } catch (err) {
    stderrLog(`Failed to read search API key from DB: ${err}`);
  }
  return undefined;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// ── Tavily 搜索 ──────────────────────────────────────

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch(TAVILY_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tavily error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
    score: 0,
  }));
}

// ── stderr 日志（不污染 stdout 的 JSON-RPC）────────────────

function stderrLog(msg: string): void {
  process.stderr.write(`[WebSearchMCP] ${msg}\n`);
}

// ── MCP Server 启动 ──────────────────────────────────────

async function main(): Promise<void> {
  stderrLog(`DB_PATH=${process.env.DB_PATH ?? "NOT SET"}`);
  stderrLog(`CWD=${process.cwd()}`);
  const server = new McpServer({
    name: "web-search-mcp",
    version: "1.0.0",
  });

  // 注册 web_search tool
  // API key 从数据库读取（MCP server 自己管理，不依赖外部传入）
  server.tool(
    "web_search",
    "Search the web using Tavily. Returns titles, URLs, and snippets.",
    {
      query: z.string().describe("The search query"),
      max_results: z.number().int().positive().max(20).default(5).describe("Maximum number of results (1-20)"),
    },
    async ({ query, max_results }) => {
      const api_key = readSearchApiKey();
      if (!api_key) {
        stderrLog("ERROR: No search API key found in database settings");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No search API key configured. Please set it in Settings → Search.", query, results: [] }) }],
          isError: true,
        };
      }
      stderrLog(`web_search called: query="${query}", max_results=${max_results}`);
      try {
        const results = await searchTavily(query, max_results ?? 5, api_key);

        stderrLog(`Returning ${results.length} results`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              query,
              results: results.map((r) => ({
                title: r.title,
                url: r.url,
                content: r.content,
              })),
            }),
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stderrLog(`web_search error: ${msg}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg, query, results: [] }) }],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  stderrLog("Web Search MCP Server starting...");
  await server.connect(transport);
  stderrLog("Web Search MCP Server connected via stdio");
}

main().catch((err) => {
  stderrLog(`Fatal error: ${err}`);
  process.exit(1);
});
