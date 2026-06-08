import { Router } from "express";
import { setApiKey } from "../security/keyStore.js";
import { registry } from "../providers/registry.js";
import { getModelCatalog } from "../providers/model-capabilities-registry.js";
import { settingsProviderInputSchema, settingsModelsQuerySchema, storeNameSchema } from "../../../shared/src/schemas/api-input.schema.js";
import { validateExternalUrl, BlockedUrlError } from "../lib/urlValidation.js";

export const settingsRouter = Router();

// B-026: GET /settings/providers 端点已删除（死代码，client 是 source of truth）

// Set provider API key
settingsRouter.put("/settings/providers/:providerId", (req, res) => {
  const idParsed = storeNameSchema.safeParse(req.params.providerId);
  if (!idParsed.success) {
    res.status(400).json({ error: idParsed.error.issues.map(i => i.message).join("; ") });
    return;
  }
  const providerId = idParsed.data;
  const parsed = settingsProviderInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join("; ") });
    return;
  }
  const { apiKey } = parsed.data;

  setApiKey(providerId, apiKey);
  res.json({ ok: true, providerId });
});

// B-026: DELETE /settings/providers/:providerId 端点已删除（死代码）
// B-026: GET /settings/providers/:providerId 端点已删除（死代码）

// bug9: 模型目录 — 返回所有 provider 的模型列表 + 能力元数据（无需 API Key）
settingsRouter.get("/providers/models", (_req, res) => {
  res.json(getModelCatalog());
});

// List available models for a provider
settingsRouter.get("/providers/:providerId/models", async (req, res) => {
  const idParsed = storeNameSchema.safeParse(req.params.providerId);
  if (!idParsed.success) {
    res.status(400).json({ error: idParsed.error.issues.map(i => i.message).join("; ") });
    return;
  }
  const providerId = idParsed.data;

  const parsed = settingsModelsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join("; ") });
    return;
  }
  const { apiKey, baseUrl } = parsed.data;

  if (baseUrl) {
    try {
      validateExternalUrl(baseUrl);
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const adapter = registry.get(providerId);
  if (!adapter) {
    res.status(404).json({ error: `Unknown provider: ${providerId}` });
    return;
  }

  try {
    const models = await adapter.listModels(apiKey, baseUrl);
    res.json({ providerId, models });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: message });
  }
});
