/**
 * In-memory key store for API keys.
 * Keys are stored in memory only by default.
 * B-027: persistKeysEncrypted 注释已删除（从未有实现）
 *
 * B-041: getApiKey 现在自动从 DB fallback 读取，不再依赖 client syncProviderKeys。
 */

import { getSyncDb } from "../lib/syncDb.js";

const keyStore = new Map<string, string>();

export function setApiKey(providerId: string, apiKey: string): void {
  keyStore.set(providerId, apiKey);
}

export function getApiKey(providerId: string): string | undefined {
  const cached = keyStore.get(providerId);
  if (cached) return cached;
  // B-041: fallback — 从 DB 读取用户配置的 provider key
  return readApiKeyFromDb(providerId);
}

/** 从 sync_data 表读取用户配置的 provider API key */
function readApiKeyFromDb(providerId: string): string | undefined {
  try {
    const db = getSyncDb();
    const row = db.prepare(
      "SELECT data FROM sync_data WHERE store_name = 'settings' AND record_id = 'app'"
    ).get() as { data: string } | undefined;
    if (!row) return undefined;
    const settings = JSON.parse(row.data);
    const provider = settings.providers?.find(
      (p: { providerId: string; apiKeyRef: string; enabled: boolean }) =>
        p.providerId === providerId && p.enabled && p.apiKeyRef
    );
    return provider?.apiKeyRef || undefined;
  } catch {
    return undefined;
  }
}

export function removeApiKey(providerId: string): boolean {
  return keyStore.delete(providerId);
}

export function clearAll(): void {
  keyStore.clear();
}

/** 返回所有已存储的 providerId → apiKey 映射 */
export function getAllApiKeys(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of keyStore) result[k] = v;
  return result;
}
