import { create, getAll, getById, remove } from "../dataClient";

const OCR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface OcrCacheEntry {
  cacheKey: string;
  text: string;
  createdAt: number;
}

export async function writeOcrCache(cacheKey: string, text: string): Promise<void> {
  await create("ocrCache", { id: cacheKey, cacheKey, text, createdAt: Date.now() });
}

export async function readOcrCache(cacheKey: string): Promise<string | null> {
  const entry = await getById<OcrCacheEntry>("ocrCache", cacheKey);
  if (!entry) return null;

  // Check 7-day expiry
  if (Date.now() - entry.createdAt > OCR_CACHE_TTL_MS) {
    await remove("ocrCache", cacheKey);
    return null;
  }

  return entry.text;
}

export async function deleteOcrCache(cacheKey: string): Promise<void> {
  await remove("ocrCache", cacheKey);
}

export async function clearExpiredOcrCache(): Promise<number> {
  const all = await getAll<OcrCacheEntry>("ocrCache");
  let cleared = 0;
  const now = Date.now();
  for (const entry of all) {
    if (now - entry.createdAt > OCR_CACHE_TTL_MS) {
      await remove("ocrCache", entry.cacheKey);
      cleared++;
    }
  }
  return cleared;
}
