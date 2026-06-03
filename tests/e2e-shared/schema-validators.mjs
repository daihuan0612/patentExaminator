/**
 * E2E 测试 Schema 验证函数
 * ========================
 *
 * 统一的输出 Schema 验证逻辑，用于验证 AI 返回的结构化数据。
 */

// ── 通用验证工具 ────────────────────────────────────────────────────

/**
 * 创建验证结果
 */
function createResult(errors) {
  return { valid: errors.length === 0, errors };
}

/**
 * 验证对象不为空
 */
function validateObject(data, name) {
  if (!data || typeof data !== "object") {
    return [`${name} must be an object`];
  }
  return [];
}

/**
 * 验证数组不为空
 */
function validateNonEmptyArray(arr, name) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return [`${name} must be non-empty array`];
  }
  return [];
}

/**
 * 验证字符串不为空
 */
function validateNonEmptyString(val, name) {
  if (typeof val !== "string" || val.length === 0) {
    return [`${name} must be non-empty string`];
  }
  return [];
}

/**
 * 验证正整数
 */
function validatePositiveInt(val, name) {
  if (typeof val !== "number" || val < 1 || !Number.isInteger(val)) {
    return [`${name} must be positive integer`];
  }
  return [];
}

/**
 * 验证枚举值
 */
function validateEnum(val, validValues, name) {
  if (!validValues.includes(val)) {
    return [`invalid ${name}: ${val}, expected one of: ${validValues.join(", ")}`];
  }
  return [];
}

// ── Citation 验证 ───────────────────────────────────────────────────

/**
 * 验证 Citation 对象
 */
export function validateCitation(obj) {
  if (!obj || typeof obj !== "object") return false;
  return (
    typeof obj.label === "string" &&
    ["high", "medium", "low"].includes(obj.confidence)
  );
}

// ── Claim Chart 验证 ────────────────────────────────────────────────

export function validateClaimChartOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validatePositiveInt(data.claimNumber, "claimNumber"));
  errors.push(...validateNonEmptyArray(data.features, "features"));

  if (Array.isArray(data.features)) {
    for (const f of data.features) {
      if (!/^[A-Z]{1,2}$/.test(f.featureCode)) {
        errors.push(`invalid featureCode: ${f.featureCode}`);
      }
      if (typeof f.description !== "string" || f.description.length < 1) {
        errors.push(`missing description for ${f.featureCode}`);
      }
      if (!["confirmed", "needs-review", "not-found"].includes(f.citationStatus)) {
        errors.push(`invalid citationStatus for ${f.featureCode}: ${f.citationStatus}`);
      }
      if (!Array.isArray(f.specificationCitations)) {
        errors.push(`specificationCitations not array for ${f.featureCode}`);
      }
    }
  }

  return createResult(errors);
}

// ── Novelty 验证 ────────────────────────────────────────────────────

export function validateNoveltyOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyString(data.referenceId, "referenceId"));
  errors.push(...validatePositiveInt(data.claimNumber, "claimNumber"));
  errors.push(...validateNonEmptyArray(data.rows, "rows"));

  if (Array.isArray(data.rows)) {
    for (const r of data.rows) {
      errors.push(
        ...validateEnum(
          r.disclosureStatus,
          ["clearly-disclosed", "possibly-disclosed", "not-found", "not-applicable"],
          `disclosureStatus for ${r.featureCode}`
        )
      );
    }
  }

  if (!Array.isArray(data.differenceFeatureCodes)) {
    errors.push("differenceFeatureCodes must be array");
  }

  return createResult(errors);
}

// ── Inventive 验证 ──────────────────────────────────────────────────

export function validateInventiveOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validatePositiveInt(data.claimNumber, "claimNumber"));

  if (!Array.isArray(data.sharedFeatureCodes)) {
    errors.push("sharedFeatureCodes must be array");
  }
  if (!Array.isArray(data.distinguishingFeatureCodes)) {
    errors.push("distinguishingFeatureCodes must be array");
  }

  errors.push(
    ...validateEnum(
      data.candidateAssessment,
      ["possibly-lacks-inventiveness", "possibly-inventive", "insufficient-evidence", "not-analyzed"],
      "candidateAssessment"
    )
  );

  return createResult(errors);
}

// ── Search References 验证 ──────────────────────────────────────────

export function validateSearchReferencesOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.candidates, "candidates"));

  if (Array.isArray(data.candidates)) {
    for (const c of data.candidates) {
      if (typeof c.title !== "string") errors.push("candidate missing title");
      if (typeof c.publicationNumber !== "string") errors.push("candidate missing publicationNumber");
      if (typeof c.relevanceScore !== "number") errors.push("candidate missing relevanceScore");
    }
  }

  return createResult(errors);
}

// ── Opinion Analysis 验证 ───────────────────────────────────────────

export function validateOpinionAnalysisOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.rejectionGrounds, "rejectionGrounds"));

  if (Array.isArray(data.rejectionGrounds)) {
    for (const g of data.rejectionGrounds) {
      if (typeof g.code !== "string") errors.push("ground missing code");
      errors.push(
        ...validateEnum(
          g.category,
          ["novelty", "inventive", "clarity", "support", "amendment", "other"],
          "category"
        )
      );
      if (!Array.isArray(g.claimNumbers)) errors.push("claimNumbers must be array");
      if (typeof g.legalBasis !== "string") errors.push("ground missing legalBasis");
    }
  }

  if (!Array.isArray(data.citedReferences)) {
    errors.push("citedReferences must be array");
  }

  return createResult(errors);
}

// ── Argument Mapping 验证 ───────────────────────────────────────────

export function validateArgumentMappingOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.mappings, "mappings"));

  if (Array.isArray(data.mappings)) {
    for (const m of data.mappings) {
      if (typeof m.rejectionGroundCode !== "string") errors.push("mapping missing code");
      errors.push(...validateEnum(m.confidence, ["high", "medium", "low"], "confidence"));
    }
  }

  return createResult(errors);
}

// ── Reexam Draft 验证 ───────────────────────────────────────────────

export function validateReexamDraftOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  if (typeof data.claimNumber !== "number") errors.push("missing claimNumber");
  errors.push(...validateNonEmptyArray(data.responseItems, "responseItems"));

  if (Array.isArray(data.responseItems)) {
    const validConclusions = [
      "argument-accepted",
      "argument-partially-accepted",
      "argument-rejected",
      "needs-further-review",
    ];
    for (const item of data.responseItems) {
      errors.push(...validateEnum(item.conclusion, validConclusions, "conclusion"));
    }
  }

  return createResult(errors);
}

// ── Summary 验证 ────────────────────────────────────────────────────

export function validateSummaryOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  if (typeof data.body !== "string" || data.body.length === 0) {
    errors.push("missing or empty body");
  }
  if (typeof data.legalCaution !== "string") {
    errors.push("missing legalCaution");
  }

  return createResult(errors);
}

// ── Defects 验证 ────────────────────────────────────────────────────

export function validateDefectsOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.defects, "defects"));

  if (Array.isArray(data.defects)) {
    const validSeverities = ["error", "warning", "info"];
    for (const d of data.defects) {
      if (typeof d.code !== "string") errors.push("defect missing code");
      if (typeof d.description !== "string") errors.push("defect missing description");
      if (typeof d.category !== "string") errors.push("defect missing category");
      errors.push(...validateEnum(d.severity, validSeverities, "severity"));
    }
  }

  return createResult(errors);
}

// ── Extract Case Fields 验证 ────────────────────────────────────────

export function validateExtractCaseFieldsOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.claims, "claims"));

  if (Array.isArray(data.claims)) {
    for (const c of data.claims) {
      if (typeof c.claimNumber !== "number") errors.push("claim missing claimNumber");
      errors.push(...validateEnum(c.type, ["independent", "dependent"], "claim type"));
      if (typeof c.rawText !== "string" || c.rawText.length === 0) {
        errors.push("claim missing rawText");
      }
    }
  }

  return createResult(errors);
}

// ── Interpret 验证 ──────────────────────────────────────────────────

export function validateInterpretOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  if (typeof data.reply !== "string" || data.reply.length < 20) {
    errors.push("reply too short or missing");
  }

  return createResult(errors);
}

// ── Translate 验证 ──────────────────────────────────────────────────

export function validateTranslateOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  if (typeof data.translatedText !== "string" || data.translatedText.length === 0) {
    errors.push("missing or empty translatedText");
  }

  return createResult(errors);
}

// ── Classify Documents 验证 ─────────────────────────────────────────

export function validateClassifyDocumentsOutput(data) {
  const errors = [...validateObject(data, "data")];
  if (errors.length > 0) return createResult(errors);

  errors.push(...validateNonEmptyArray(data.classifications, "classifications"));

  if (Array.isArray(data.classifications)) {
    const validRoles = [
      "application",
      "office-action",
      "office-action-response",
      "amended-claims",
      "reference",
      "other",
    ];
    for (const c of data.classifications) {
      if (typeof c.fileIndex !== "number") errors.push("classification missing fileIndex");
      errors.push(...validateEnum(c.role, validRoles, "role"));
      if (typeof c.confidence !== "string") errors.push("classification missing confidence");
    }
  }

  return createResult(errors);
}

// ── 验证器映射 ──────────────────────────────────────────────────────

/** 所有验证器的映射表 */
export const SCHEMA_VALIDATORS = {
  "claim-chart": validateClaimChartOutput,
  novelty: validateNoveltyOutput,
  inventive: validateInventiveOutput,
  "search-references": validateSearchReferencesOutput,
  "opinion-analysis": validateOpinionAnalysisOutput,
  "argument-mapping": validateArgumentMappingOutput,
  "reexam-draft": validateReexamDraftOutput,
  summary: validateSummaryOutput,
  defects: validateDefectsOutput,
  "extract-case-fields": validateExtractCaseFieldsOutput,
  interpret: validateInterpretOutput,
  translate: validateTranslateOutput,
  "classify-documents": validateClassifyDocumentsOutput,
};

/**
 * 根据 agent 名称获取对应的验证器
 */
export function getValidator(agent) {
  return SCHEMA_VALIDATORS[agent] || null;
}
