import { describe, it, expect, beforeEach } from "vitest";
import { setApiKey, getApiKey, removeApiKey, listProviders } from "@server/security/keyStore";

describe("keyStore", () => {
  // Clear the store before each test
  beforeEach(() => {
    // Remove all keys
    for (const provider of listProviders()) {
      removeApiKey(provider);
    }
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

  describe("listProviders", () => {
    it("TC-KEY-008: empty store returns empty array", () => {
      expect(listProviders()).toEqual([]);
    });

    it("TC-KEY-009: list with multiple providers", () => {
      setApiKey("kimi", "key-1");
      setApiKey("glm", "key-2");
      setApiKey("mimo", "key-3");

      const providers = listProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain("kimi");
      expect(providers).toContain("glm");
      expect(providers).toContain("mimo");
    });

    it("TC-KEY-010: list after removal", () => {
      setApiKey("kimi", "key-1");
      setApiKey("glm", "key-2");

      removeApiKey("kimi");

      const providers = listProviders();
      expect(providers).toHaveLength(1);
      expect(providers).toContain("glm");
    });
  });
});
