/**
 * 健康检查测试
 * ===========
 *
 * 测试服务器健康检查端点。
 */

import { getJSON, log } from "../e2e-shared/index.mjs";

/**
 * 测试健康检查端点
 */
export async function testHealthCheck() {
  const res = await getJSON("/health");
  const data = await res.json();
  log("GET /api/health returns 200", res.status === 200, `status=${res.status}`);
  log("GET /api/health has status:ok", data.status === "ok", JSON.stringify(data));
}
