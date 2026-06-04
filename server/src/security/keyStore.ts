/**
 * In-memory key store for API keys.
 * Keys are stored in memory only by default.
 * B-027: persistKeysEncrypted 注释已删除（从未有实现）
 */

const keyStore = new Map<string, string>();

export function setApiKey(providerId: string, apiKey: string): void {
  keyStore.set(providerId, apiKey);
}

export function getApiKey(providerId: string): string | undefined {
  return keyStore.get(providerId);
}

export function removeApiKey(providerId: string): boolean {
  return keyStore.delete(providerId);
}

export function clearAll(): void {
  keyStore.clear();
}
