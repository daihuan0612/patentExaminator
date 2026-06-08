/**
 * 模型目录 — bug9: 从 server API 获取，不再硬编码
 *
 * 单一数据源在 server/src/providers/model-capabilities-registry.ts。
 * client 通过 GET /api/providers/models 获取完整目录（含能力元数据）。
 */

import { useState, useEffect } from "react";
import type { ProviderId, ModelInfo } from "@shared/types/agents";
import { fetchModelCatalog } from "./api";

/** 从 server 获取的原始模型数据（含扩展字段） */
interface ServerModelInfo extends ModelInfo {
  contextWindow?: number;
  maxOutputTokens?: number;
  isReasoning?: boolean;
  supportsVision?: boolean;
  supportsStructuredOutput?: boolean;
}

let _catalogCache: Record<string, ServerModelInfo[]> | null = null;
let _catalogPromise: Promise<Record<string, ServerModelInfo[]>> | null = null;

function loadCatalog(): Promise<Record<string, ServerModelInfo[]>> {
  if (_catalogCache) return Promise.resolve(_catalogCache);
  if (!_catalogPromise) {
    _catalogPromise = fetchModelCatalog()
      .then((data) => {
        _catalogCache = data as Record<string, ServerModelInfo[]>;
        return _catalogCache;
      })
      .catch((err) => {
        console.error("[ModelCatalog] Failed to fetch model catalog:", err);
        _catalogPromise = null; // 允许重试
        return {} as Record<string, ServerModelInfo[]>;
      });
  }
  return _catalogPromise;
}

/**
 * 获取模型目录 hook — 组件挂载时自动从 server 加载。
 * 返回 catalog（按 providerId 分组的 ModelInfo[]）和加载状态。
 */
export function useModelCatalog() {
  const [catalog, setCatalog] = useState<Record<string, ServerModelInfo[]>>(_catalogCache ?? {});

  useEffect(() => {
    let mounted = true;
    loadCatalog().then((data) => {
      if (mounted && Object.keys(data).length > 0) {
        setCatalog(data);
      }
    });
    return () => { mounted = false; };
  }, []);

  return catalog;
}

/** 从目录中获取单个模型的元数据 */
export function getModelMeta(providerId: string, modelId: string, catalog?: Record<string, ServerModelInfo[]>): ModelInfo | undefined {
  const src = catalog ?? _catalogCache;
  if (!src) return undefined;
  const exact = src[providerId]?.find((m) => m.id === modelId);
  if (exact) return exact;
  // Gemini fallback: 按模型名推断推荐语
  if (providerId === "gemini") return inferGeminiMeta(modelId);
  return undefined;
}

/** 获取某 provider 的模型 ID 列表 */
export function getModelIds(providerId: ProviderId, catalog?: Record<string, ServerModelInfo[]>): string[] {
  const src = catalog ?? _catalogCache;
  if (!src) return [];
  return (src[providerId] ?? []).map((m) => m.id);
}

/**
 * Gemini 免费 tier 配额按模型系列推断 (flash-lite > flash > pro)。
 * 查询 API 返回的模型 ID 可能不在目录里，用此函数兜底。
 */
function inferGeminiMeta(id: string): ModelInfo {
  if (id.includes("flash-lite")) {
    return { id, recommendation: "最推荐 (速度极快、配额最高)", rpm: 30, rpd: 2000, tpm: "15.0M" };
  }
  if (id.includes("flash")) {
    return { id, recommendation: "综合能力均衡", rpm: 15, rpd: 1500, tpm: "25.0M" };
  }
  if (id.includes("pro")) {
    return { id, recommendation: "高级能力 (配额较低)", rpm: 2, rpd: 50, tpm: "12.5M" };
  }
  return { id, recommendation: "通用模型", rpm: 15, rpd: 1500, tpm: "25.0M" };
}
