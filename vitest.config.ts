import { defineConfig } from "vitest/config";
import { baseConfig, baseTestConfig } from "./vitest.base.config";

export default defineConfig({
  test: {
    ...baseTestConfig,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
  resolve: baseConfig.resolve,
});
