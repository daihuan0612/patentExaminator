#!/usr/bin/env node
/**
 * 验证测试代码不能写入生产数据库（B-042）
 * 运行: node tests/verify-prod-isolation.mjs
 */

import { strict as assert } from "assert";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

// ── 测试 1: assertNotProdWrite 阻断写操作 ──

console.log("\n=== 1. http.mjs 写操作阻断 ===");

// 保存原始值
const origAllow = process.env.ALLOW_TEST_PROD;
const origTestBase = process.env.TEST_BASE;

// 设置 TEST_BASE 指向 localhost:3000（模拟未隔离场景）
process.env.TEST_BASE = "http://localhost:3000/api";
delete process.env.ALLOW_TEST_PROD;

// 动态导入以获取最新状态
const httpModule = await import(`./e2e-shared/http.mjs?t=${Date.now()}`);
const { postJSON, uploadFile } = httpModule;

test("POST 指向 localhost:3000 无 ALLOW_TEST_PROD → 抛异常", async () => {
  try {
    await postJSON("/sync/upload", { stores: {} });
    assert.fail("应该抛异常");
  } catch (err) {
    assert.ok(err.message.includes("安全阻断"), `异常信息应包含"安全阻断"，实际: ${err.message}`);
  }
});

test("UPLOAD 指向 localhost:3000 无 ALLOW_TEST_PROD → 抛异常", async () => {
  try {
    const fd = new FormData();
    await uploadFile("/knowledge/upload", fd);
    assert.fail("应该抛异常");
  } catch (err) {
    assert.ok(err.message.includes("安全阻断"), `异常信息应包含"安全阻断"，实际: ${err.message}`);
  }
});

test("POST 指向 localhost:3000 有 ALLOW_TEST_PROD → 不阻断", async () => {
  process.env.ALLOW_TEST_PROD = "1";
  try {
    // 会因为服务器不存在而网络错误，但不会是"安全阻断"异常
    await postJSON("/sync/upload", { stores: {} });
    // 如果服务器恰好在跑，也 OK
  } catch (err) {
    assert.ok(!err.message.includes("安全阻断"), `不应被安全阻断，实际: ${err.message}`);
  } finally {
    delete process.env.ALLOW_TEST_PROD;
  }
});

// ── 测试 2: getTestBase() 空值阻断 ──

console.log("\n=== 2. getTestBase() 空值阻断 ===");

delete process.env.TEST_BASE;

const envModule = await import(`./e2e-shared/env.mjs?t=${Date.now()}`);
const { getTestBase } = envModule;

test("TEST_BASE 未设置 → getTestBase() 抛异常", () => {
  try {
    getTestBase();
    assert.fail("应该抛异常");
  } catch (err) {
    assert.ok(err.message.includes("未设置测试服务器地址"), `异常信息应包含提示，实际: ${err.message}`);
  }
});

test("TEST_BASE 设置后 → getTestBase() 正常返回", () => {
  process.env.TEST_BASE = "http://localhost:9999/api";
  try {
    const base = getTestBase();
    assert.equal(base, "http://localhost:9999/api");
  } finally {
    delete process.env.TEST_BASE;
  }
});

// ── 测试 3: DEFAULT_TEST_BASE 为空 ──

console.log("\n=== 3. DEFAULT_TEST_BASE 为空 ===");

const configModule = await import(`./e2e-shared/config.mjs?t=${Date.now()}`);

test("DEFAULT_TEST_BASE 为空字符串", () => {
  assert.equal(configModule.DEFAULT_TEST_BASE, "", `实际值: "${configModule.DEFAULT_TEST_BASE}"`);
});

// ── 恢复环境变量 ──

if (origAllow !== undefined) process.env.ALLOW_TEST_PROD = origAllow;
else delete process.env.ALLOW_TEST_PROD;
if (origTestBase !== undefined) process.env.TEST_BASE = origTestBase;
else delete process.env.TEST_BASE;

// ── 结果 ──

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
