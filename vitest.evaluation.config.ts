import { defineConfig } from "vitest/config";
import { baseConfig, baseTestConfig } from "./vitest.base.config";

export default defineConfig({
  test: {
    ...baseTestConfig,
    include: ["tests/evaluation/**/*.test.ts"],
  },
  resolve: baseConfig.resolve,
});
