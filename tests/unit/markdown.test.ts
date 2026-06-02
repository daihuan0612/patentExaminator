import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@client/lib/markdown";

describe("renderMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("renders markdown to HTML", () => {
    const result = renderMarkdown("**bold** and *italic*");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("sanitizes script tags (XSS protection)", () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain("<script>");
  });

  it("sanitizes img onerror (XSS protection)", () => {
    const result = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  it("preserves safe HTML elements", () => {
    const result = renderMarkdown("# Title\n\nParagraph with **bold**");
    expect(result).toContain("<h1>");
    expect(result).toContain("<strong>");
  });
});
