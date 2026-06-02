/**
 * Agent 编排 API 路由 — B-035: 将 AgentClient 协调逻辑迁移到服务端
 *
 * POST /api/agent/run — 服务端编排入口
 */
import { Router } from "express";
import express from "express";
import { runAgent } from "../lib/orchestrator.js";
import { logger } from "../lib/logger.js";

export const agentRouter = Router();

agentRouter.post("/agent/run", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const {
      agent,
      caseId,
      request: requestData,
      providerPreference,
      modelId,
      modelFallbacks,
      enableModelFallback,
      providerBaseUrls,
      maxTokens,
      knowledgeEnabled,
      apiKey,
    } = req.body as {
      agent: string;
      caseId: string;
      request: Record<string, unknown>;
      providerPreference?: string[];
      modelId?: string;
      modelFallbacks?: Record<string, string[]>;
      enableModelFallback?: Record<string, boolean>;
      providerBaseUrls?: Record<string, string>;
      maxTokens?: number;
      knowledgeEnabled?: boolean;
      apiKey?: string;
    };

    if (!agent || !caseId) {
      res.status(400).json({ ok: false, error: { type: "validation", message: "Missing agent or caseId" } });
      return;
    }

    logger.info(`Agent run request: agent=${agent}, caseId=${caseId}`);

    const result = await runAgent({
      agent,
      caseId,
      request: requestData ?? {},
      providerPreference,
      modelId,
      modelFallbacks,
      enableModelFallback,
      providerBaseUrls,
      maxTokens,
      signal: req.signal,
      knowledgeEnabled,
      apiKey,
    });

    if (!result.ok) {
      const status = result.error?.type === "unsupported" ? 501 : 500;
      res.status(status).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error("Agent run error: " + (err instanceof Error ? err.message : String(err)));
    res.status(500).json({ ok: false, error: { type: "server", message: "Internal server error" } });
  }
});
