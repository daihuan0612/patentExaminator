import { fileURLToPath } from "url";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vitest 基础配置
 *
 * 所有 Vitest 配置文件（unit、integration、evaluation）都应继承此配置。
 * 避免重复定义 resolve.alias 等公共配置。
 */
export const baseConfig = {
  resolve: {
    alias: {
      "@shared": `${root}/shared/src`,
      "@client": `${root}/client/src`,
      "@server": `${root}/server/src`,
    },
  },
};

/**
 * 基础测试配置
 */
export const baseTestConfig = {
  environment: "happy-dom" as const,
  setupFiles: ["./tests/setup.ts"],
  globals: true,
};
