/**
 * 知识库查询扩展（客户端）
 * MIGRATE-007: 文本预处理函数已迁移到 server/src/routes/knowledge.ts
 * 仅保留客户端仍在使用的查询扩展函数
 */

/** 计算文本 hash（用于 embedding 缓存） */
export async function hashChunkText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── 查询扩展 ───────────────────────────────────────────

/** 跨语言扩展：中文关键词 → 英文同义词 */
export const CROSS_LANG_MAP: Record<string, string[]> = {
  "权利要求": ["claim", "claims"],
  "说明书": ["description", "specification"],
  "摘要": ["abstract"],
  "技术方案": ["technical solution", "technical scheme"],
  "技术特征": ["technical feature", "technical features"],
  "发明目的": ["object of the invention", "purpose"],
  "有益效果": ["beneficial effect", "advantageous effect"],
  "背景技术": ["background art", "background technology"],
  "实施方式": ["embodiment", "embodiments"],
  "附图": ["drawing", "drawings", "figures"],
};

/** 跨语言查询扩展 */
export function expandCrossLanguage(query: string): string {
  const expanded: string[] = [query];
  for (const [zh, enList] of Object.entries(CROSS_LANG_MAP)) {
    if (query.includes(zh)) {
      expanded.push(...enList);
    }
  }
  return expanded.join(" ");
}

/** 法律同义词扩展 */
export const LEGAL_SYNONYMS: Record<string, string[]> = {
  "新颖性": ["novelty", "new"],
  "创造性": ["inventive step", "inventiveness", "非显而易见性"],
  "实用性": ["utility", "工业实用性"],
  "充分公开": ["sufficient disclosure", "enablement"],
  "权利要求": ["claim", "claims", "权项"],
  "说明书": ["specification", "description"],
  "修改": ["amendment", "修改"],
  "答复": ["response", "reply"],
};

/** 法律同义词查询扩展 */
export function expandQuery(query: string): string {
  const expanded: string[] = [query];
  for (const [term, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
    if (query.includes(term)) {
      expanded.push(...synonyms);
    }
  }
  return expanded.join(" ");
}
