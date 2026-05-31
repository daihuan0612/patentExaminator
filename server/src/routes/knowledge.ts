/**
 * 知识库 API 路由 — 服务端处理提取/切片/向量化
 */
import { Router } from "express";
import express from "express";
import multer from "multer";
import crypto from "crypto";
import {
  addSource,
  getAllSources,
  deleteSource,
  addChunks,
  getUnembeddedChunks,
  markChunkEmbedded,
  getAllVectors,
  getAllChunks,
  getStats,
  clearAll,
  findDuplicateByHash,
} from "../lib/knowledgeDb.js";
import { extractText, extractFromUrl } from "../lib/knowledgeExtract.js";
import { logger } from "../lib/logger.js";

export const knowledgeRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Embedding（内联实现，避免大型依赖） ──────────────

let embedder: { embed: (texts: string[]) => Promise<number[][]>; modelId: string } | null = null;

async function getEmbedder() {
  if (embedder) return embedder;

  logger.info("Loading embedding model...");
  try {
    const { pipeline } = await import("@xenova/transformers");
    const pipe = await pipeline("feature-extraction", "Xenova/bge-large-zh-v1.5", {
      quantized: true,
    });
    embedder = {
      embed: async (texts: string[]) => {
        const results: number[][] = [];
        for (const text of texts) {
          // 截断到 512 token ≈ 750 字符
          const truncated = text.length > 750 ? text.slice(0, 750) : text;
          const output = await pipe(truncated, { pooling: "mean", normalize: true });
          results.push(Array.from(output.data));
        }
        return results;
      },
      modelId: "Xenova/bge-large-zh-v1.5",
    };
    logger.info("Embedding model loaded");
    return embedder;
  } catch (err) {
    logger.error(`Failed to load embedding model: ${err}`);
    throw err;
  }
}

// ── 简化切片 ─────────────────────────────────────────

function simpleChunk(text: string, fileName: string): Array<{ text: string; metadata: Record<string, unknown> }> {
  const chunks: Array<{ text: string; metadata: Record<string, unknown> }> = [];
  const lines = text.split("\n");
  let current: string[] = [];
  let sectionId = "";

  for (const line of lines) {
    // 检测章节/条文标题
    const sectionMatch = line.match(/^(第[一二三四五六七八九十百千\d]+[部分章节条款]|[一二三四五六七八九十]+\s*[、.])/);
    const articleMatch = line.match(/^第[一二三四五六七八九十百千零\d]+条/);

    if ((sectionMatch || articleMatch) && current.length > 0 && current.join("\n").trim().length >= 20) {
      chunks.push({
        text: current.join("\n").trim(),
        metadata: { fileName, mediaType: "text", sectionId },
      });
      current = [];
      sectionId = line.trim().slice(0, 50);
    }
    current.push(line);
  }

  if (current.length > 0 && current.join("\n").trim().length >= 20) {
    chunks.push({
      text: current.join("\n").trim(),
      metadata: { fileName, mediaType: "text", sectionId },
    });
  }

  // 合并过小的 chunk
  return chunks;
}

// ── API 端点 ─────────────────────────────────────────

/** POST /api/knowledge/upload — 上传文件并处理 */
knowledgeRouter.post("/knowledge/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "No file provided" });
      return;
    }

    const file = req.file;
    const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");

    // 文件级去重
    const existing = findDuplicateByHash(fileHash);
    if (existing) {
      res.json({ ok: true, skipped: true, message: `已存在: ${existing.name}` });
      return;
    }

    const sourceId = `ks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = file.originalname;

    // 提取文本
    const extraction = await extractText(file.buffer, fileName);

    // 切片
    const rawChunks = simpleChunk(extraction.text, fileName);

    // 存储 source
    addSource({
      id: sourceId,
      name: fileName,
      type: "file",
      format: fileName.split(".").pop() ?? "txt",
      mediaType: extraction.mediaType,
      size: file.size,
      fileHash,
      chunkCount: rawChunks.length,
      embedStatus: "processing",
    });

    // 存储 chunks
    const chunks = rawChunks.map((rc, i) => ({
      id: `${sourceId}-c${i}`,
      sourceId,
      index: i,
      text: rc.text,
      strategy: "auto",
      metadata: rc.metadata,
    }));
    addChunks(chunks);

    // 向量化
    if (chunks.length > 0) {
      const emb = await getEmbedder();
      const texts = chunks.map((c) => c.text);
      const vectors = await emb.embed(texts);
      const vectorRecords = chunks.map((c, i) => ({
        chunkId: c.id,
        vector: vectors[i]!,
        modelId: emb.modelId,
      }));
      addVectors(vectorRecords);
      for (const chunk of chunks) {
        markChunkEmbedded(chunk.id);
      }
    }

    logger.info(`Uploaded ${fileName}: ${chunks.length} chunks embedded`);
    res.json({
      ok: true,
      sourceId,
      fileName,
      chunkCount: chunks.length,
      message: `✅ ${fileName} — ${chunks.length} 条知识已入库`,
    });
  } catch (err) {
    logger.error("Knowledge upload error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** POST /api/knowledge/import-url — 从 URL 导入 */
knowledgeRouter.post("/knowledge/import-url", express.json(), async (req, res) => {
  try {
    const { url } = req.body as { url: string };
    if (!url) {
      res.status(400).json({ ok: false, error: "Missing url" });
      return;
    }

    const sourceId = `ks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const extraction = await extractFromUrl(url);
    const rawChunks = simpleChunk(extraction.text, url);

    addSource({
      id: sourceId,
      name: url,
      type: "url",
      format: "html",
      mediaType: "text",
      sourceUrl: url,
      chunkCount: rawChunks.length,
      embedStatus: "processing",
    });

    const chunks = rawChunks.map((rc, i) => ({
      id: `${sourceId}-c${i}`,
      sourceId,
      index: i,
      text: rc.text,
      strategy: "auto",
      metadata: rc.metadata,
    }));
    addChunks(chunks);

    if (chunks.length > 0) {
      const emb = await getEmbedder();
      const vectors = await emb.embed(chunks.map((c) => c.text));
      addVectors(chunks.map((c, i) => ({ chunkId: c.id, vector: vectors[i]!, modelId: emb.modelId })));
      for (const c of chunks) markChunkEmbedded(c.id);
    }

    res.json({ ok: true, sourceId, chunkCount: chunks.length, message: `✅ ${url} — ${chunks.length} 条知识已入库` });
  } catch (err) {
    logger.error("Knowledge URL import error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** GET /api/knowledge/sources — 列出所有来源 */
knowledgeRouter.get("/knowledge/sources", (_req, res) => {
  try {
    res.json({ ok: true, sources: getAllSources() });
  } catch (err) {
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** DELETE /api/knowledge/sources/:id — 删除来源 */
knowledgeRouter.delete("/knowledge/sources/:id", (req, res) => {
  try {
    deleteSource(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** GET /api/knowledge/stats — 统计信息 */
knowledgeRouter.get("/knowledge/stats", (_req, res) => {
  try {
    res.json({ ok: true, ...getStats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** POST /api/knowledge/search — 检索 */
knowledgeRouter.post("/knowledge/search", express.json(), async (req, res) => {
  try {
    const { query, topK = 5 } = req.body as { query: string; topK?: number };
    if (!query) {
      res.status(400).json({ ok: false, error: "Missing query" });
      return;
    }

    const emb = await getEmbedder();
    const queryVector = (await emb.embed([query]))[0]!;
    const allChunks = getAllChunks();
    const allVectors = getAllVectors();

    // 构建 chunkId → chunk 映射
    const chunkMap = new Map(allChunks.map((c) => [c.id, c]));
    const vectorMap = new Map(allVectors.map((v) => [v.chunkId, v]));

    // 余弦相似度计算
    const scores: Array<{ chunkId: string; score: number }> = [];
    for (const [chunkId, vec] of vectorMap) {
      const chunk = chunkMap.get(chunkId);
      if (!chunk) continue;

      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < queryVector.length; i++) {
        dot += queryVector[i]! * vec.vector[i]!;
        normA += queryVector[i]! * queryVector[i]!;
        normB += vec.vector[i]! * vec.vector[i]!;
      }
      const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
      if (score >= 0.3) {
        scores.push({ chunkId, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    const topResults = scores.slice(0, topK).map((s) => {
      const chunk = chunkMap.get(s.chunkId)!;
      return {
        chunkId: s.chunkId,
        text: chunk.text,
        metadata: JSON.parse(chunk.metadata),
        score: s.score,
      };
    });

    res.json({ ok: true, results: topResults });
  } catch (err) {
    logger.error("Knowledge search error: " + errMsg(err));
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});

/** DELETE /api/knowledge/clear — 清空全部 */
knowledgeRouter.delete("/knowledge/clear", (_req, res) => {
  try {
    clearAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
});
