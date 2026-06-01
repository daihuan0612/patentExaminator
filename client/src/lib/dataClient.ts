/**
 * 客户端数据访问层 — MIGRATE-001: 主存储从 IndexedDB 迁移到 SQLite
 * 提供通用的 CRUD 操作，替代 IndexedDB
 */

const API_BASE = "/api/data";

/** 获取指定 store 的所有记录 */
export async function getAll<T>(store: string): Promise<T[]> {
  const res = await fetch(`${API_BASE}/${store}`);
  if (!res.ok) throw new Error(`Failed to get ${store}: ${res.status}`);
  const data = await res.json() as { ok: boolean; records: T[] };
  return data.records;
}

/** 按字段过滤记录 */
export async function query<T>(store: string, field: string, value: unknown): Promise<T[]> {
  const res = await fetch(`${API_BASE}/${store}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, value }),
  });
  if (!res.ok) throw new Error(`Failed to query ${store}: ${res.status}`);
  const data = await res.json() as { ok: boolean; records: T[] };
  return data.records;
}

/** 获取指定记录 */
export async function getById<T>(store: string, id: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}/${store}/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to get ${store}/${id}: ${res.status}`);
  const data = await res.json() as { ok: boolean; record: T };
  return data.record;
}

/** 创建记录 */
export async function create<T extends { id: string }>(store: string, record: T): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`Failed to create ${store}: ${res.status}`);
}

/** 更新记录 */
export async function update<T>(store: string, id: string, data: T): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update ${store}/${id}: ${res.status}`);
}

/** 删除记录 */
export async function remove(store: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete ${store}/${id}: ${res.status}`);
}

/** 删除指定 store 的所有记录 */
export async function clearStore(store: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${store}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to clear ${store}: ${res.status}`);
}
