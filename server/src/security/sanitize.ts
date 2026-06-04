/**
 * Sanitize user input before sending to AI providers.
 * Removes sensitive patterns like API keys, emails, phone numbers.
 * Defends against basic prompt injection attempts.
 */

// Zero-width characters: U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ), U+FEFF (BOM)
// eslint-disable-next-line no-misleading-character-class -- intentional: these are the exact codepoints to strip
const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g;

import { logger } from "../lib/logger.js";

const DEFAULT_PATTERNS = [
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: "[EMAIL]" },
  { pattern: /\b1[3-9]\d{9}\b/g, replace: "[PHONE]" },
  { pattern: /(?:sk|tp|ak)-[A-Za-z0-9]{20,}/g, replace: "[API_KEY]" },
];

// Prompt injection patterns \u2014 neutralize by wrapping in quotes
const INJECTION_PATTERNS = [
  // English instruction override attempts
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/gi,
  /you\s+are\s+now\s+(a|an|the)\s+/gi,
  /forget\s+(everything|all|your)\s+(you|instructions?|rules?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi,
  /new\s+instructions?\s*:/gi,
  /system\s*:\s*/gi,
  /override\s+(all\s+)?(previous|prior|system)\s+(instructions?|prompts?)/gi,
  // Chinese instruction override attempts
  /\u5ffd\u7565(\u4ee5\u4e0a|\u4e4b\u524d|\u524d\u9762|\u6240\u6709)(\u7684)?(\u6307\u4ee4|\u6307\u793a|\u63d0\u793a|\u89c4\u5219|\u8981\u6c42|\u7ea6\u675f)/g,
  /\u4f60(\u73b0\u5728|\u4ece\u73b0\u5728\u5f00\u59cb)\u662f/g,
  /\u5fd8\u8bb0(\u6240\u6709|\u4e00\u5207|\u4e4b\u524d\u7684)(\u6307\u4ee4|\u89c4\u5219|\u8981\u6c42)/g,
  /\u65e0\u89c6(\u4ee5\u4e0a|\u4e4b\u524d|\u6240\u6709)(\u7684)?(\u6307\u4ee4|\u6307\u793a|\u89c4\u5219)/g,
  /\u65b0(\u7684)?\u6307\u4ee4\s*[:\uff1a]/g,
  /\u7cfb\u7edf\s*[:\uff1a]\s*/g,
  // Prompt delimiter injection
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /```system/gi,
  /```instructions?/gi,
];

export interface SanitizeRule {
  pattern: string;
  replace: string;
  note?: string;
}

export function sanitizeText(
  text: string,
  customRules?: SanitizeRule[]
): string {
  // Strip zero-width characters that can be used for prompt injection
  let result = text.replace(ZERO_WIDTH_RE, "");

  // Apply default PII patterns
  for (const rule of DEFAULT_PATTERNS) {
    result = result.replace(rule.pattern, rule.replace);
  }

  // Neutralize prompt injection attempts by wrapping in quotes
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, (match) => `"[SANITIZED: ${match}]"`);
  }

  // Apply custom rules
  if (customRules) {
    for (const rule of customRules) {
      try {
        const regex = new RegExp(rule.pattern, "g");
        result = result.replace(regex, rule.replace);
      } catch (e) {
        logger.warn("Failed to apply sanitize rule:", { error: e });
      }
    }
  }

  return result;
}
