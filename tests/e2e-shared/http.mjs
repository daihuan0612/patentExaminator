/**
 * E2E 测试 HTTP 工具函数
 * ======================
 *
 * 统一的 HTTP 请求封装，支持 JSON POST 和 GET 请求。
 */

import { getTestBase } from "./env.mjs";

/** 默认请求超时（30 秒） */
const DEFAULT_TIMEOUT_MS = 30_000;

// ── HTTP 请求工具 ────────────────────────────────────────────────────

/**
 * 发送 JSON POST 请求
 */
export async function postJSON(pathname, body, baseUrl) {
  const base = baseUrl || getTestBase();
  return fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}

/**
 * 发送 GET 请求
 */
export async function getJSON(pathname, baseUrl) {
  const base = baseUrl || getTestBase();
  return fetch(`${base}${pathname}`, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}

/**
 * 发送带 query 参数的 GET 请求
 */
export async function getJSONWithParams(pathname, params, baseUrl) {
  const base = baseUrl || getTestBase();
  const url = new URL(`${base}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString());
}

/**
 * 上传文件（FormData）
 */
export async function uploadFile(pathname, formData, baseUrl) {
  const base = baseUrl || getTestBase();
  return fetch(`${base}${pathname}`, {
    method: "POST",
    body: formData,
  });
}

// ── 响应解析工具 ────────────────────────────────────────────────────

/**
 * 解析 JSON 响应，自动处理错误
 */
export async function parseJsonResponse(res) {
  try {
    const data = await res.json();
    return {
      ok: res.ok && data.ok !== false,
      data: data,
      error: data.error?.message || null,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err.message || "Failed to parse JSON",
    };
  }
}

/**
 * 解析 SSE 流式响应（用于知识库上传等）
 */
export async function parseSSEResponse(res) {
  try {
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data: "));

    // 从后向前查找 done 或 error 事件
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(lines[i].slice(6));
        if (data.step === "done" || data.step === "error") {
          return {
            ok: data.step === "done",
            data,
            error: data.step === "error" ? data.error : null,
          };
        }
      } catch {
        // 跳过解析失败的行
      }
    }

    return { ok: false, data: null, error: "No done event found" };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err.message || "Failed to parse SSE response",
    };
  }
}
