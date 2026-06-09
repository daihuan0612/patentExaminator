/**
 * E2E 测试运行器
 * ===============
 *
 * 统一的测试运行和结果收集逻辑，用于所有 E2E 测试脚本。
 */

// ── 全局状态 ────────────────────────────────────────────────────────

let results = [];
let currentSuiteName = "";
let groupTimings = [];
let currentGroupStart = 0;

// ── 测试运行器 ──────────────────────────────────────────────────────

/**
 * 重置测试结果
 */
export function resetResults() {
  results = [];
  groupTimings = [];
}

/**
 * 设置当前测试套件名称
 */
export function setSuiteName(name) {
  currentSuiteName = name;
}

/**
 * 记录测试结果
 * @param {string} test - 测试名称
 * @param {boolean} pass - 是否通过
 * @param {string} detail - 详情
 * @param {object} [options] - 额外选项
 * @param {boolean} [options.skipped] - 是否为跳过
 */
export function log(test, pass, detail = "", options = {}) {
  const icon = options.skipped ? "SKIP" : pass ? "PASS" : "FAIL";
  const prefix = currentSuiteName ? `[${currentSuiteName}] ` : "";
  console.log(`[${icon}] ${prefix}${test}${detail ? " - " + detail : ""}`);

  if (!pass && !options.skipped) {
    const stack = new Error().stack
      ?.split("\n")
      .slice(2, 5)
      .map((l) => l.trim())
      .join(" <- ");
    console.log(`       at: ${stack}`);
  }

  results.push({
    test: `${prefix}${test}`,
    pass,
    detail,
    skipped: options.skipped || false,
    duration: options.duration ?? 0,
  });
}

/**
 * 运行单个测试
 */
export async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    log(name, true, `${duration}ms`, { duration });
    return true;
  } catch (err) {
    const duration = Date.now() - start;
    const errorMessage = err.message || String(err);
    log(name, false, errorMessage, { duration });
    return false;
  }
}

/**
 * 批量运行测试
 */
export async function runTests(tests) {
  const start = Date.now();
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await runTest(test.name, test.fn);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  const duration = Date.now() - start;
  return getSummary(duration);
}

// ── 结果汇总 ────────────────────────────────────────────────────────

/**
 * 获取测试汇总
 */
export function getSummary(duration) {
  const passed = results.filter((r) => r.pass && !r.skipped).length;
  const failed = results.filter((r) => !r.pass).length;
  const skipped = results.filter((r) => r.skipped).length;

  return {
    total: results.length,
    passed,
    failed,
    skipped,
    duration: duration || 0,
    results: [...results],
    failures: results.filter((r) => !r.pass),
  };
}

/**
 * 打印测试汇总
 */
export function printSummary(duration) {
  const summary = getSummary(duration);

  console.log("\n═══════════════════════════════════════════");
  const parts = [`${summary.passed}/${summary.total} 通过`];
  if (summary.failed > 0) parts.push(`${summary.failed} 失败`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} 跳过`);
  console.log(`  测试结果: ${parts.join(" | ")}`);
  if (duration) {
    console.log(`  耗时: ${(duration / 1000).toFixed(2)}s`);
  }
  console.log("═══════════════════════════════════════════");

  if (summary.failures.length > 0) {
    console.log("\n失败的测试:");
    for (const r of summary.failures) {
      console.log(`  ✗ ${r.test}: ${r.detail}`);
    }
  }
}

/**
 * 检查是否所有测试都通过（跳过的不算失败）
 */
export function allPassed() {
  return results.every((r) => r.pass || r.skipped);
}

/**
 * 获取失败的测试
 */
export function getFailures() {
  return results.filter((r) => !r.pass);
}

// ── 断言工具 ────────────────────────────────────────────────────────

/**
 * 断言条件为真
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * 断言两个值相等
 */
export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

/**
 * 断言数组包含指定元素
 */
export function assertIncludes(arr, item, message) {
  if (!arr.includes(item)) {
    throw new Error(
      message || `Expected array to include ${JSON.stringify(item)}, got [${arr.join(", ")}]`
    );
  }
}

/**
 * 断言对象不为空
 */
export function assertNotEmpty(value, message) {
  if (value === null || value === undefined || value === "") {
    throw new Error(message || "Expected non-empty value");
  }
}

/**
 * 断言数组长度大于等于指定值
 */
export function assertMinLength(arr, minLength, message) {
  if (arr.length < minLength) {
    throw new Error(
      message || `Expected array length >= ${minLength}, got ${arr.length}`
    );
  }
}

// ── 分组计时 ────────────────────────────────────────────────────────

/**
 * 开始一个测试分组计时
 */
export function startGroup(name) {
  currentGroupStart = Date.now();
}

/**
 * 结束当前测试分组计时
 */
export function endGroup(name) {
  const duration = Date.now() - currentGroupStart;
  groupTimings.push({ name, duration });
}

/**
 * 打印最慢的 N 个测试
 */
export function printSlowTests(n = 10) {
  const timed = results.filter((r) => r.duration > 0 && !r.skipped);
  if (timed.length === 0) return;

  const sorted = [...timed].sort((a, b) => b.duration - a.duration);
  const top = sorted.slice(0, n);

  console.log(`\n─── Top ${Math.min(n, top.length)} Slowest Tests ───`);
  for (const r of top) {
    const bar = "█".repeat(Math.min(Math.round(r.duration / 500), 40));
    console.log(`  ${String(r.duration).padStart(6)}ms ${bar} ${r.test}`);
  }
}

/**
 * 打印分组耗时
 */
export function printGroupTimings() {
  if (groupTimings.length === 0) return;

  console.log(`\n─── Group Timings ───`);
  const total = groupTimings.reduce((sum, g) => sum + g.duration, 0);
  for (const g of groupTimings) {
    const pct = ((g.duration / total) * 100).toFixed(0);
    const bar = "█".repeat(Math.min(Math.round(g.duration / 1000), 40));
    console.log(`  ${String(g.duration).padStart(6)}ms (${pct.padStart(3)}%) ${bar} ${g.name}`);
  }
  console.log(`  ${String(total).padStart(6)}ms        TOTAL`);
}

// ── 进度显示 ────────────────────────────────────────────────────────

/**
 * 打印测试组标题
 */
export function printGroupTitle(title) {
  console.log(`\n─── ${title} ───`);
}

/**
 * 打印分隔线
 */
export function printSeparator() {
  console.log("\n═══════════════════════════════════════════");
}

/**
 * 打印跳过信息
 */
export function printSkipped(name, reason) {
  console.log(`[SKIP] ${name} - ${reason}`);
  results.push({ test: name, pass: true, detail: `skipped: ${reason}`, skipped: true });
}
