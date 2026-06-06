/**
 * OCR API 路由 — MIGRATE-002: OCR 从前端迁移到后端
 * 使用 Node.js Tesseract 进行 OCR
 */
import { Router } from "express";
import multer from "multer";
import { createWorker } from "tesseract.js";
import { logger } from "../lib/logger.js";
import { ocrLangSchema } from "../../../shared/src/schemas/api-input.schema.js";

export const ocrRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** POST /api/ocr — 执行 OCR */
ocrRouter.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "No file provided" });
      return;
    }

    const langParsed = ocrLangSchema.safeParse(req.body.lang);
    if (!langParsed.success) {
      res.status(400).json({ ok: false, error: langParsed.error.issues.map(i => i.message).join("; ") });
      return;
    }
    const lang = langParsed.data;
    const file = req.file;
    const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");

    logger.info(`OCR request: ${originalName} (${file.size} bytes, lang: ${lang})`);

    // 创建 Tesseract worker
    const worker = await createWorker(lang);

    try {
      // 执行 OCR
      const { data } = await worker.recognize(file.buffer);

      const result = {
        text: data.text,
        pageTexts: [data.text],
        confidence: data.confidence,
      };

      logger.info(`OCR completed: ${originalName} - ${data.confidence}% confidence, ${data.text.length} chars`);

      res.json({ ok: true, ...result });
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    logger.error("OCR error: " + (err instanceof Error ? err.message : String(err)));
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
