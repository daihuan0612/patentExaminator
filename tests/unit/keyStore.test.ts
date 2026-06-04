import { describe, it, expect, beforeEach } from "vitest";
import { setApiKey, getApiKey, removeApiKey, clearAll } from "@server/security/keyStore";

describe("keyStore", () => {
  // Clear the store before each test
  beforeEach(() => {
    clearAll();
  });

  describe("setApiKey / getApiKey", () => {
    it("TC-KEY-001: set and get a key", () => {
      setApiKey("kimi", "test-api-key-123");
      expect(getApiKey("kimi")).toBe("test-api-key-123");
    });

    it("TC-KEY-002: overwrite existing key", () => {
      setApiKey("glm", "old-key");
      setApiKey("glm", "new-key");
      expect(getApiKey("glm")).toBe("new-key");
    });

    it("TC-KEY-003: get non-existent key returns undefined", () => {
      expect(getApiKey("nonexistent")).toBeUndefined();
    });

    it("TC-KEY-004: multiple providers", () => {
      setApiKey("kimi", "key-kimi");
      setApiKey("glm", "key-glm");
      setApiKey("mimo", "key-mimo");

      expect(getApiKey("kimi")).toBe("key-kimi");
      expect(getApiKey("glm")).toBe("key-glm");
      expect(getApiKey("mimo")).toBe("key-mimo");
    });
  });

  describe("removeApiKey", () => {
    it("TC-KEY-005: remove existing key", () => {
      setApiKey("kimi", "test-key");
      const removed = removeApiKey("kimi");

      expect(removed).toBe(true);
      expect(getApiKey("kimi")).toBeUndefined();
    });

    it("TC-KEY-006: remove non-existent key returns false", () => {
      const removed = removeApiKey("nonexistent");
      expect(removed).toBe(false);
    });

    it("TC-KEY-007: remove does not affect other keys", () => {
      setApiKey("kimi", "key-kimi");
      setApiKey("glm", "key-glm");

      removeApiKey("kimi");

      expect(getApiKey("kimi")).toBeUndefined();
      expect(getApiKey("glm")).toBe("key-glm");
    });
  });
});
