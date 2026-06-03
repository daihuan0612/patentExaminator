import { defineConfig } from "vitest/config";
import { baseConfig, baseTestConfig } from "./vitest.base.config";

export default defineConfig({
  test: {
    ...baseTestConfig,
    include: ["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"],
    globalSetup: "./tests/globalSetup.ts",
  },
  resolve: baseConfig.resolve,
});
