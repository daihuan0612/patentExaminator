/**
 * 粗略估算文本的 token 数。
 * 中文（含全角标点）约 0.6 tokens/字，其余字符约 0.3 tokens/char。
 * 不追求精确，只用于截断决策。
 */
export function estimateTokens(text: string): number {
  // eslint-disable-next-line no-irregular-whitespace
  const chineseChars = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length;
  const latinChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 0.6 + latinChars * 0.3);
}
