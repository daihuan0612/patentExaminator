/**
 * 服务端知识库存储 — SQLite + 向量化
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "./logger.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "knowledge.db");

let db: Database.Database | null = null;

export function getKnowledgeDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      file_hash TEXT,
      source_url TEXT,
      chunk_count INTEGER DEFAULT 0,
      embed_status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      strategy TEXT DEFAULT 'auto',
      metadata TEXT DEFAULT '{}',
      embedded INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kb_vectors (
      chunk_id TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
    );
  `);

  logger.info(`Knowledge DB initialized at ${DB_PATH}`);
  return db;
}

// ── Sources ─────────────────────────────────────────

export function addSource(source: {
  id: string; name: string; type: string; format: string;
  mediaType: string; size: number; fileHash?: string; sourceUrl?: string;
  chunkCount: number; embedStatus: string;
}): void {
  const db = getKnowledgeDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO kb_sources
    (id, name, type, format, media_type, size, file_hash, source_url, chunk_count, embed_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source.id, source.name, source.type, source.format, source.mediaType,
      source.size, source.fileHash ?? null, source.sourceUrl ?? null,
      source.chunkCount, source.embedStatus, now, now);
}

export function getAllSources(): Array<{
  id: string; name: string; type: string; format: string;
  mediaType: string; size: number; fileHash: string | null;
  sourceUrl: string | null; chunkCount: number; embedStatus: string;
  createdAt: string; updatedAt: string;
}> {
  const db = getKnowledgeDb();
  return db.prepare("SELECT * FROM kb_sources").all().map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    type: row.type as string,
    format: row.format as string,
    mediaType: row.media_type as string,
    size: row.size as number,
    fileHash: row.file_hash as string | null,
    sourceUrl: row.source_url as string | null,
    chunkCount: row.chunk_count as number,
    embedStatus: row.embed_status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export function deleteSource(id: string): void {
  const db = getKnowledgeDb();
  db.prepare("DELETE FROM kb_chunks WHERE source_id = ?").run(id);
  db.prepare("DELETE FROM kb_sources WHERE id = ?").run(id);
}

// ── Chunks ──────────────────────────────────────────

export function addChunks(chunks: Array<{
  id: string; sourceId: string; index: number; text: string;
  strategy: string; metadata: Record<string, unknown>;
}>): void {
  const db = getKnowledgeDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO kb_chunks
    (id, source_id, idx, text, strategy, metadata, embedded, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const chunk of chunks) {
      stmt.run(chunk.id, chunk.sourceId, chunk.index, chunk.text,
        chunk.strategy, JSON.stringify(chunk.metadata), now);
    }
  });
  tx();
}

export function getUnembeddedChunks(): Array<{
  id: string; sourceId: string; index: number; text: string;
  strategy: string; metadata: string; embedded: number;
}> {
  const db = getKnowledgeDb();
  return db.prepare("SELECT * FROM kb_chunks WHERE embedded = 0").all() as Array<{
    id: string; sourceId: string; index: number; text: string;
    strategy: string; metadata: string; embedded: number;
  }>;
}

export function markChunkEmbedded(chunkId: string): void {
  const db = getKnowledgeDb();
  db.prepare("UPDATE kb_chunks SET embedded = 1 WHERE id = ?").run(chunkId);
}

export function getAllChunks(): Array<{
  id: string; sourceId: string; text: string; metadata: string;
}> {
  const db = getKnowledgeDb();
  return db.prepare("SELECT id, source_id as sourceId, text, metadata FROM kb_chunks").all() as Array<{
    id: string; sourceId: string; text: string; metadata: string;
  }>;
}

// ── Vectors ─────────────────────────────────────────

export function addVectors(vectors: Array<{
  chunkId: string; vector: number[]; modelId: string;
}>): void {
  const db = getKnowledgeDb();
  const stmt = db.prepare(`INSERT OR REPLACE INTO kb_vectors
    (chunk_id, vector, model_id, created_at) VALUES (?, ?, ?, ?)`);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const vec of vectors) {
      stmt.run(vec.chunkId, JSON.stringify(vec.vector), vec.modelId, now);
    }
  });
  tx();
}

export function getAllVectors(): Array<{
  chunkId: string; vector: number[]; modelId: string;
}> {
  const db = getKnowledgeDb();
  return (db.prepare("SELECT * FROM kb_vectors").all() as Array<{
    chunk_id: string; vector: string; model_id: string;
  }>).map(row => ({
    chunkId: row.chunk_id,
    vector: JSON.parse(row.vector) as number[],
    modelId: row.model_id,
  }));
}

export function getStats(): { sourceCount: number; chunkCount: number; embeddedCount: number } {
  const db = getKnowledgeDb();
  const sources = (db.prepare("SELECT COUNT(*) as c FROM kb_sources").get() as { c: number }).c;
  const chunks = (db.prepare("SELECT COUNT(*) as c FROM kb_chunks").get() as { c: number }).c;
  const embedded = (db.prepare("SELECT COUNT(*) as c FROM kb_chunks WHERE embedded = 1").get() as { c: number }).c;
  return { sourceCount: sources, chunkCount: chunks, embeddedCount: embedded };
}

export function clearAll(): void {
  const db = getKnowledgeDb();
  db.exec("DELETE FROM kb_vectors");
  db.exec("DELETE FROM kb_chunks");
  db.exec("DELETE FROM kb_sources");
}

export function findDuplicateByHash(fileHash: string): { id: string; name: string } | null {
  const db = getKnowledgeDb();
  return db.prepare("SELECT id, name FROM kb_sources WHERE file_hash = ?").get(fileHash) as { id: string; name: string } | null;
}
