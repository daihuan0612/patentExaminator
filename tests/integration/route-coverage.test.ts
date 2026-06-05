/**
 * Integration tests for route-level HTTP endpoint coverage (BUG-126)
 *
 * Covers the 7 route files not directly tested by server-routes.test.ts:
 * - data.ts, documents.ts, knowledge.ts, ocr.ts, search.ts, sync.ts, agent.ts
 *
 * Strategy: create Express app per test group, mock external deps, use supertest.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

// Mock external dependencies
vi.mock("@server/providers/registry.js", () => ({
  registry: {
    get: vi.fn(),
    runWithFallback: vi.fn().mockResolvedValue({
      response: { text: '{"ok":true}', tokenUsage: { input: 10, output: 5, total: 15 } },
      attempts: [{ providerId: "mock", ok: true }]
    }),
    listModels: vi.fn().mockResolvedValue(["mock-model"]),
  }
}));

vi.mock("@server/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// B-042: 注入内存数据库，隔离生产库（必须在 import server routes 之前）
import { resetSyncDbForTesting } from "@server/lib/syncDb.js";
beforeAll(() => { resetSyncDbForTesting(":memory:"); });

// ── Data routes ───────────────────────────────────────────────

describe("Data routes — /api/data/:store", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { dataRouter } = await import("@server/routes/data.js");
    app = express();
    app.use(express.json());
    app.use("/api", dataRouter);
  });

  it("GET /api/data/:store returns records list", async () => {
    const res = await request(app).get("/api/data/test-store");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("records");
  });

  it("POST /api/data/:store/query validates input", async () => {
    const res = await request(app)
      .post("/api/data/test-store/query")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Sync routes ───────────────────────────────────────────────

describe("Sync routes — /api/sync", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { syncRouter } = await import("@server/routes/sync.js");
    app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use("/api", syncRouter);
  });

  it("GET /api/sync/status returns status", async () => {
    const res = await request(app).get("/api/sync/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("GET /api/sync/download returns data", async () => {
    const res = await request(app).get("/api/sync/download");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});

// ── Knowledge routes ──────────────────────────────────────────

describe("Knowledge routes — /api/knowledge", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { knowledgeRouter } = await import("@server/routes/knowledge.js");
    app = express();
    app.use(express.json());
    app.use("/api", knowledgeRouter);
  });

  it("GET /api/knowledge/sources returns sources list", async () => {
    const res = await request(app).get("/api/knowledge/sources");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("sources");
  });

  it("GET /api/knowledge/stats returns stats", async () => {
    const res = await request(app).get("/api/knowledge/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("POST /api/knowledge/search validates input", async () => {
    const res = await request(app)
      .post("/api/knowledge/search")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Agent routes ──────────────────────────────────────────────

describe("Agent routes — /api/agent", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { agentRouter } = await import("@server/routes/agent.js");
    app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/api", agentRouter);
  });

  it("POST /api/agent/run validates input", async () => {
    const res = await request(app)
      .post("/api/agent/run")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("ok", false);
  });

  it("POST /api/agent/run accepts valid input", async () => {
    const res = await request(app)
      .post("/api/agent/run")
      .send({ agent: "chat", caseId: "test", request: { userMessage: "hi" }, providerPreference: ["gemini"], apiKey: "test-key" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});

// ── Documents routes ──────────────────────────────────────────

describe("Document routes — /api/documents", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { documentsRouter } = await import("@server/routes/documents.js");
    app = express();
    app.use(express.json());
    app.use("/api", documentsRouter);
  });

  it("POST /api/documents/extract-html validates input", async () => {
    const res = await request(app)
      .post("/api/documents/extract-html")
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/documents/extract-html parses HTML", async () => {
    const res = await request(app)
      .post("/api/documents/extract-html")
      .send({ html: "<html><body><p>Hello world</p></body></html>" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });

  it("POST /api/documents/parse-claims validates input", async () => {
    const res = await request(app)
      .post("/api/documents/parse-claims")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Search routes ─────────────────────────────────────────────

describe("Search routes — /api/search-references", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { searchRouter } = await import("@server/routes/search.js");
    app = express();
    app.use(express.json());
    app.use("/api", searchRouter);
  });

  it("POST /api/search-references validates missing required fields", async () => {
    const res = await request(app)
      .post("/api/search-references")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("ok", false);
  });
});

// ── OCR routes ────────────────────────────────────────────────

describe("OCR routes — /api/ocr", () => {
  let app: express.Express;

  beforeEach(async () => {
    const { ocrRouter } = await import("@server/routes/ocr.js");
    app = express();
    app.use(express.json());
    app.use("/api", ocrRouter);
  });

  it("POST /api/ocr rejects request without file", async () => {
    const res = await request(app)
      .post("/api/ocr")
      .send({});
    expect(res.status).toBe(400);
  });
});
