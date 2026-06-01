import { create, query, remove, update } from "../dataClient";
import type { ChatSession, ChatMessage } from "@shared/types/domain";
import { createLogger } from "../logger";

const log = createLogger("chatRepo");

export async function createSession(session: ChatSession): Promise<void> {
  log("createSession called:", session.id, session.caseId, session.title);
  await create("chatSessions", session as ChatSession & { id: string });
  log("createSession saved:", session.id);
}

export async function getSessionsByCaseId(caseId: string): Promise<ChatSession[]> {
  log("getSessionsByCaseId called for:", caseId);
  const sessions = await query<ChatSession>("chatSessions", "caseId", caseId);
  log("getSessionsByCaseId result:", sessions.length, "sessions");
  return sessions;
}

export async function deleteSession(id: string): Promise<void> {
  log("deleteSession called:", id);
  await remove("chatSessions", id);
  log("deleteSession completed:", id);
}

export async function updateSession(session: ChatSession): Promise<void> {
  log("updateSession called:", session.id);
  await update("chatSessions", session.id, session);
  log("updateSession saved:", session.id);
}

export async function deleteMessagesBySessionId(sessionId: string): Promise<void> {
  log("deleteMessagesBySessionId called:", sessionId);
  const messages = await query<ChatMessage>("chatMessages", "sessionId", sessionId);
  log("deleteMessagesBySessionId found:", messages.length, "messages to delete");
  for (const msg of messages) {
    await remove("chatMessages", msg.id);
  }
  log("deleteMessagesBySessionId completed:", sessionId);
}

export async function createMessage(message: ChatMessage): Promise<void> {
  log("createMessage called:", message.id, "sessionId:", message.sessionId, "role:", message.role);
  await create("chatMessages", message as ChatMessage & { id: string });
  log("createMessage saved:", message.id);
}

export async function getMessagesBySessionId(sessionId: string): Promise<ChatMessage[]> {
  log("getMessagesBySessionId called for:", sessionId);
  const messages = await query<ChatMessage>("chatMessages", "sessionId", sessionId);
  log("getMessagesBySessionId result:", messages.length, "messages");
  return messages;
}
