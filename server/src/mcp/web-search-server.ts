/**
 * NF1: Web Search MCP Server
 *
 * 暴露 web_search tool，使用 Serper.dev 搜索引擎。
 * 通过 stdio transport 与 MCP client 通信。
 *
 * 注意：日志必须走 stderr（stdout 被 JSON-RPC 占用）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";

const FETCH_TIMEOUT_MS = 30_000;

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

// 从数据库读取 Serper 配置
function readSerperConfig(): { apiKey: string; baseUrl: string } | undefined {
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
      const settings = JSON.parse(row.data) as { searchProviders?: Array<{ providerId: string; enabled: boolean; apiKeyRef: string; baseUrl?: string }> };
      const provider = settings.searchProviders?.find((p) => p.providerId === "serper" && p.enabled && p.apiKeyRef);
      if (provider) {
        return {
          apiKey: provider.apiKeyRef,
          baseUrl: provider.baseUrl || "https://google.serper.dev",
        };
      }
    }
  } catch (err) {
    stderrLog(`Failed to read Serper config from DB: ${err}`);
  }
  return undefined;
}

// ── Serper.dev 搜索 ──────────────────────────────────────

async function searchSerper(
  query: string,
  maxResults: number,
  apiKey: string,
  baseUrl: string
): Promise<SearchResult[]> {
  const endpoint = baseUrl + "/search";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Serper error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    organic?: Array<{ title: string; link: string; snippet: string; position?: number }>;
  };

  return (data.organic ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    content: r.snippet,
    score: r.position ? 1 / r.position : 0,
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

  // 注册 web_search tool — 使用 Serper.dev 搜索
  // API key 从数据库读取（用户在 Settings → Search 中配置 Serper）
  server.tool(
    "web_search",
    "Search the web using Serper.dev. Returns titles, URLs, and snippets.",
    {
      query: z.string().describe("The search query"),
      max_results: z.number().int().positive().max(20).default(5).describe("Maximum number of results (1-20)"),
    },
    async ({ query, max_results }) => {
      const config = readSerperConfig();
      if (!config) {
        stderrLog("ERROR: Serper.dev not configured in Settings → Search");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Serper.dev not configured. Please enable it in Settings → Search and set your API key.", query, results: [] }) }],
          isError: true,
        };
      }
      stderrLog(`web_search called: provider=serper, baseUrl=${config.baseUrl}, query="${query}", max_results=${max_results}`);
      try {
        const results = await searchSerper(query, max_results ?? 5, config.apiKey, config.baseUrl);

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
