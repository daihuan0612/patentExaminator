/**
 * Chat Persistence Tests — B-042: 测试数据库隔离机制
 *
 * 测试聊天历史持久化场景，验证 SQLite 持久化层正确存储和检索聊天数据。
 * 模拟页面刷新场景：写入数据 → 清空内存 → 从 DB 恢复。
 *
 * B-038 后数据层从 IndexedDB 迁移到 SQLite。
 * 使用内存数据库隔离，不访问生产数据库。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMemoryDb,
  dbCreate, dbGetAll, dbGetById, dbQuery, dbUpdate, dbDelete, dbClearAll,
  type TestDb,
} from "../helpers/testDb";
import type Database from "better-sqlite3";

let tdb: TestDb;
let db: Database.Database;

const testCaseId = "test-case-persistence";
const testSessionId = "test-session-persistence";

beforeEach(() => {
  tdb = createMemoryDb();
  db = tdb.db;
});

afterEach(() => {
  tdb.cleanup();
});

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: testSessionId,
    caseId: testCaseId,
    moduleScope: "novelty",
    title: "测试聊天会话",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    caseId: testCaseId,
    sessionId: testSessionId,
    moduleScope: "novelty",
    role: "user",
    content: "测试消息",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Chat persistence scenarios
// ═══════════════════════════════════════════════════════════════

describe("Chat persistence scenarios (SQLite)", () => {
  it("should persist chat session to SQLite and retrieve it", () => {
    const session = makeSession();
    dbCreate(db, "chatSessions", session.id, session);

    const savedSessions = dbQuery(db, "chatSessions", "caseId", testCaseId);
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0]!.title).toBe("测试聊天会话");
    expect(savedSessions[0]!.moduleScope).toBe("novelty");
  });

  it("should persist chat messages to SQLite and retrieve them", () => {
    const session = makeSession();
    dbCreate(db, "chatSessions", session.id, session);

    const userMessage = makeMessage({
      id: "msg-user-1",
      role: "user",
      content: "请帮我分析这个技术特征",
    });
    const assistantMessage = makeMessage({
      id: "msg-assistant-1",
      role: "assistant",
      content: "好的，我来分析这个技术特征...",
    });

    dbCreate(db, "chatMessages", userMessage.id, userMessage);
    dbCreate(db, "chatMessages", assistantMessage.id, assistantMessage);

    const savedMessages = dbQuery(db, "chatMessages", "sessionId", testSessionId);
    expect(savedMessages).toHaveLength(2);
    const userMsg = savedMessages.find(m => m.role === "user");
    const assistantMsg = savedMessages.find(m => m.role === "assistant");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("请帮我分析这个技术特征");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("好的，我来分析这个技术特征...");
  });

  it("should simulate page refresh: clear memory then reload from SQLite", () => {
    // 写入数据
    const session = makeSession({ moduleScope: "inventive", title: "创造性分析讨论" });
    dbCreate(db, "chatSessions", session.id, session);

    const userMessage = makeMessage({
      id: "msg-refresh-test",
      moduleScope: "inventive",
      content: "页面刷新测试消息",
    });
    dbCreate(db, "chatMessages", userMessage.id, userMessage);

    // 模拟页面刷新：从 DB 重新加载
    const storedSessions = dbQuery(db, "chatSessions", "caseId", testCaseId);
    expect(storedSessions).toHaveLength(1);
    expect(storedSessions[0]!.title).toBe("创造性分析讨论");

    const allMessages: Array<Record<string, unknown>> = [];
    for (const s of storedSessions) {
      const msgs = dbQuery(db, "chatMessages", "sessionId", s.id);
      allMessages.push(...msgs);
    }
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0]!.content).toBe("页面刷新测试消息");
  });

  it("should handle multiple sessions for same case", () => {
    const session1 = makeSession({ id: `${testSessionId}-1`, title: "新颖性讨论1" });
    const session2 = makeSession({ id: `${testSessionId}-2`, title: "新颖性讨论2" });

    dbCreate(db, "chatSessions", session1.id, session1);
    dbCreate(db, "chatSessions", session2.id, session2);

    dbCreate(db, "chatMessages", "msg-s1", {
      id: "msg-s1", caseId: testCaseId, sessionId: `${testSessionId}-1`,
      moduleScope: "novelty", role: "user", content: "会话1的消息", createdAt: new Date().toISOString(),
    });
    dbCreate(db, "chatMessages", "msg-s2", {
      id: "msg-s2", caseId: testCaseId, sessionId: `${testSessionId}-2`,
      moduleScope: "novelty", role: "user", content: "会话2的消息", createdAt: new Date().toISOString(),
    });

    const sessions = dbQuery(db, "chatSessions", "caseId", testCaseId);
    expect(sessions).toHaveLength(2);

    const msgs1 = dbQuery(db, "chatMessages", "sessionId", `${testSessionId}-1`);
    expect(msgs1).toHaveLength(1);
    expect(msgs1[0]!.content).toBe("会话1的消息");

    const msgs2 = dbQuery(db, "chatMessages", "sessionId", `${testSessionId}-2`);
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0]!.content).toBe("会话2的消息");
  });

  it("delete session → messages should be cleaned up (application-level cascade)", () => {
    const session = makeSession();
    dbCreate(db, "chatSessions", session.id, session);
    dbCreate(db, "chatMessages", "msg-1", makeMessage());

    // 应用层级联清理
    const messages = dbQuery(db, "chatMessages", "sessionId", testSessionId);
    for (const m of messages) {
      dbDelete(db, "chatMessages", m.id);
    }
    dbDelete(db, "chatSessions", testSessionId);

    expect(dbQuery(db, "chatSessions", "caseId", testCaseId)).toHaveLength(0);
    expect(dbQuery(db, "chatMessages", "sessionId", testSessionId)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Chat persistence: DB schema verification
// ═══════════════════════════════════════════════════════════════

describe("Chat persistence: DB schema verification (SQLite)", () => {
  it("chatSessions and chatMessages tables should exist and be queryable", () => {
    // 写入一条 session 和 message 验证表结构正确
    const session = makeSession({ id: "schema-verify-session" });
    dbCreate(db, "chatSessions", session.id, session);

    const msg = makeMessage({ id: "schema-verify-msg", sessionId: "schema-verify-session" });
    dbCreate(db, "chatMessages", msg.id, msg);

    const sessions = dbQuery(db, "chatSessions", "caseId", testCaseId);
    expect(sessions).toHaveLength(1);

    const messages = dbQuery(db, "chatMessages", "sessionId", "schema-verify-session");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("测试消息");

    // 清理
    dbDelete(db, "chatMessages", "schema-verify-msg");
    dbDelete(db, "chatSessions", "schema-verify-session");
  });

  it("should be able to query chat messages by sessionId", () => {
    dbCreate(db, "chatMessages", "q1", { id: "q1", sessionId: "s1", caseId: "c1", moduleScope: "novelty", role: "user", content: "msg1", createdAt: new Date().toISOString() });
    dbCreate(db, "chatMessages", "q2", { id: "q2", sessionId: "s2", caseId: "c1", moduleScope: "novelty", role: "user", content: "msg2", createdAt: new Date().toISOString() });

    const s1Messages = dbQuery(db, "chatMessages", "sessionId", "s1");
    expect(s1Messages).toHaveLength(1);
    expect(s1Messages[0]!.content).toBe("msg1");

    const s2Messages = dbQuery(db, "chatMessages", "sessionId", "s2");
    expect(s2Messages).toHaveLength(1);
    expect(s2Messages[0]!.content).toBe("msg2");
  });
});
