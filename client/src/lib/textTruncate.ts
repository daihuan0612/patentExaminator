/**
 * Smart text truncation that preserves beginning and end.
 * Used to fit long documents into model context windows without losing
 * the most important content (claims at the start, conclusions at the end).
 */

// B-029: ModelTier 和 truncateByTier 已删除（从未被引用）

/**
 * Truncate text smartly: keep first 40% and last 40%, insert [...] separator.
 * If text fits within maxChars, return as-is.
 */
export function truncateForModel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const keepStart = Math.floor(maxChars * 0.4);
  const keepEnd = Math.floor(maxChars * 0.4);

  // Try to break at paragraph boundaries
  const startChunk = breakAtParagraph(text, 0, keepStart, "forward");
  const endChunk = breakAtParagraph(text, text.length - keepEnd, text.length, "backward");

  return `${startChunk}\n\n[...]\n\n${endChunk}`;
}

/**
 * Try to break text at a paragraph boundary near the target position.
 */
function breakAtParagraph(
  text: string,
  start: number,
  target: number,
  direction: "forward" | "backward"
): string {
  const searchRange = Math.floor(target * 0.1); // 10% flexibility
  const from = direction === "forward" ? target : Math.max(start, target - searchRange);
  const to = direction === "forward" ? Math.min(target + searchRange, text.length) : target;

  // Look for newline in the flexibility range
  const segment = text.slice(from, to);
  const newlineIdx = direction === "forward"
    ? segment.indexOf("\n")
    : segment.lastIndexOf("\n");

  if (newlineIdx >= 0) {
    const breakAt = from + newlineIdx;
    return direction === "forward"
      ? text.slice(0, breakAt)
      : text.slice(breakAt + 1);
  }

  // No paragraph break found, use hard cut
  return direction === "forward"
    ? text.slice(0, target)
    : text.slice(target);
}
