import { getDB } from "../indexedDb";
import type { ChatSession, ChatMessage } from "@shared/types/domain";
import { createLogger } from "../logger";

const log = createLogger("chatRepo");

export async function createSession(session: ChatSession): Promise<void> {
  log("createSession called:", session.id, session.caseId, session.title);
  const db = await getDB();
  await db.put("chatSessions", session);
  log("createSession saved to IndexedDB:", session.id);
}

export async function getSessionsByCaseId(caseId: string): Promise<ChatSession[]> {
  log("getSessionsByCaseId called for:", caseId);
  const db = await getDB();
  const sessions = await db.getAllFromIndex("chatSessions", "by-caseId", caseId);
  log("getSessionsByCaseId result:", sessions.length, "sessions", sessions.map(s => s.id));
  return sessions;
}

export async function deleteSession(id: string): Promise<void> {
  log("deleteSession called:", id);
  const db = await getDB();
  await db.delete("chatSessions", id);
  log("deleteSession completed:", id);
}

export async function updateSession(session: ChatSession): Promise<void> {
  log("updateSession called:", session.id);
  const db = await getDB();
  await db.put("chatSessions", session);
  log("updateSession saved:", session.id);
}

export async function deleteMessagesBySessionId(sessionId: string): Promise<void> {
  log("deleteMessagesBySessionId called:", sessionId);
  const db = await getDB();
  const messages = await db.getAllFromIndex("chatMessages", "by-sessionId", sessionId);
  log("deleteMessagesBySessionId found:", messages.length, "messages to delete");
  const tx = db.transaction("chatMessages", "readwrite");
  for (const msg of messages) {
    await tx.store.delete(msg.id);
  }
  await tx.done;
  log("deleteMessagesBySessionId completed:", sessionId);
}

export async function createMessage(message: ChatMessage): Promise<void> {
  log("createMessage called:", message.id, "sessionId:", message.sessionId, "role:", message.role);
  const db = await getDB();
  await db.put("chatMessages", message);
  log("createMessage saved to IndexedDB:", message.id);
}

export async function getMessagesBySessionId(sessionId: string): Promise<ChatMessage[]> {
  log("getMessagesBySessionId called for:", sessionId);
  const db = await getDB();
  const messages = await db.getAllFromIndex("chatMessages", "by-sessionId", sessionId);
  log("getMessagesBySessionId result:", messages.length, "messages", messages.map(m => m.id));
  return messages;
}