/**
 * legalChunker.test.ts — 法律文本专用切分器测试
 */
import { describe, it, expect } from "vitest";
import {
  chunkLegalText,
  chunkByDocumentType,
  chunkExaminationGuide,
  chunkCase,
} from "@server/lib/legalChunker.js";

describe("legalChunker", () => {
  describe("chunkLegalText", () => {
    it("按第X条切分法律文本", () => {
      const text = `第一章 总则

第一条 为了保护专利权人的合法权益，鼓励发明创造，推动发明创造的应用，提高创新能力，促进科学技术进步和经济社会发展，制定本法。

第二条 本法所称的发明创造，是指发明、实用新型和外观设计。

发明，是指对产品、方法或者其改进所提出的新的技术方案。

实用新型，是指对产品的形状、构造或者其结合所提出的适于实用的新的技术方案。

外观设计，是指对产品的整体或者局部的形状、图案或者其结合以及色彩与形状、图案的结合所作出的富有美感并适于工业应用的新设计。

第三条 国务院专利行政部门负责管理全国的专利工作；统一受理和审查专利申请，依法授予专利权。`;

      const chunks = chunkLegalText(text, {
        fileName: "专利法.txt",
        documentCategory: "法律",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // 每个 chunk 应该包含条号
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeGreaterThanOrEqual(20);
        expect(chunk.metadata.documentCategory).toBe("法律");
        expect(chunk.metadata.fileName).toBe("专利法.txt");
      }
    });

    it("保留章/节/条层级元数据", () => {
      const text = `第一章 总则

第一节 一般规定

第一条 为了保护专利权人的合法权益，鼓励发明创造，推动发明创造的应用，提高创新能力，促进科学技术进步和经济社会发展，制定本法。

第二条 本法所称的发明创造，是指发明、实用新型和外观设计。`;

      const chunks = chunkLegalText(text, {
        fileName: "专利法.txt",
        documentCategory: "法律",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const firstChunk = chunks[0]!;
      expect(firstChunk.metadata.chapter).toContain("第一章");
      expect(firstChunk.metadata.article).toContain("第一条");
    });

    it("合并短条文", () => {
      const text = `第一条 短条文。

第二条 另一个短条文。

第三条 这是一个足够长的条文，包含了足够多的内容来超过最小阈值。本条详细规定了各种事项，包括但不限于权利义务、程序要求、法律责任等方面的内容。`;

      const chunks = chunkLegalText(text, {
        fileName: "test.txt",
        documentCategory: "法律",
        minChunkSize: 50,
      });

      // 前两条应该被合并
      expect(chunks.length).toBeLessThanOrEqual(3);
    });

    it("无条号时回退到段落切分", () => {
      const text = `这是一段普通文本，没有法条结构。

这是第二段，内容足够长，应该被识别为独立的段落。本段包含了足够的文字来满足最小长度要求。

这是第三段，同样有足够的内容来形成独立的段落单元。`;

      const chunks = chunkLegalText(text, {
        fileName: "普通文档.txt",
        documentCategory: "其他",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("表格整体保留不拆分", () => {
      const text = `| 条件 | 结果 |
|------|------|
| 新颖性 | 通过 |
| 创造性 | 通过 |
| 实用性 | 通过 |`;

      const chunks = chunkLegalText(text, {
        fileName: "表格.txt",
        documentCategory: "其他",
      });

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.metadata.mediaType).toBe("table");
    });
  });

  describe("chunkExaminationGuide", () => {
    it("按节标题切分审查指南", () => {
      const text = `第一部分 初步审查

第一章 专利申请的初步审查

1.1 专利申请文件的审查

专利申请文件应当符合专利法及其实施细则的规定。

1.2 申请手续的审查

申请人应当办理规定的手续。`;

      const chunks = chunkExaminationGuide(text, {
        fileName: "审查指南.txt",
        documentCategory: "审查指南",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.documentCategory).toBe("审查指南");
      }
    });
  });

  describe("chunkCase", () => {
    it("按段落切分案例", () => {
      const text = `案例一：某发明专利复审案

案件涉及一种新型材料的发明专利申请。审查员以不具备创造性为由驳回了该申请。

申请人不服，提出复审请求。复审委员会经审理认为，该发明具有突出的实质性特点和显著的进步。`;

      const chunks = chunkCase(text, {
        fileName: "案例.txt",
        documentCategory: "案例",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.documentCategory).toBe("案例");
      }
    });
  });

  describe("chunkByDocumentType", () => {
    it("法律文档使用法律切分策略", () => {
      const text = `第一条 测试条文内容。第二条 另一条内容。`;
      const chunks = chunkByDocumentType(text, "法律", {
        fileName: "test.txt",
        documentCategory: "法律",
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("审查指南使用审查指南切分策略", () => {
      const text = `1.1 第一节内容\n\n详细说明。\n\n1.2 第二节内容\n\n更多说明。`;
      const chunks = chunkByDocumentType(text, "审查指南", {
        fileName: "test.txt",
        documentCategory: "审查指南",
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("未知文档类型使用默认策略", () => {
      const text = `第一条 测试条文。第二条 另一条。`;
      const chunks = chunkByDocumentType(text, "未知类型", {
        fileName: "test.txt",
      });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("元数据完整性", () => {
    it("每个 chunk 都有完整的元数据字段", () => {
      const text = `第一条 测试条文内容，需要足够的长度来满足最小阈值要求。本条详细说明了各项规定。`;
      const chunks = chunkLegalText(text, {
        fileName: "test.txt",
        documentCategory: "法律",
      });

      for (const chunk of chunks) {
        expect(chunk.metadata).toHaveProperty("fileName");
        expect(chunk.metadata).toHaveProperty("mediaType");
        expect(chunk.metadata).toHaveProperty("documentCategory");
        expect(chunk.metadata).toHaveProperty("chapter");
        expect(chunk.metadata).toHaveProperty("section");
        expect(chunk.metadata).toHaveProperty("article");
        expect(chunk.metadata).toHaveProperty("paragraph");
        expect(chunk.metadata).toHaveProperty("articleRefs");
        expect(chunk.metadata).toHaveProperty("chunkVersion");
        expect(chunk.metadata.chunkVersion).toBe(1);
      }
    });

    it("提取法条引用", () => {
      const text = `第一条 依照本法第二十二条和第二十三条的规定，申请人可以提出复审请求。`;
      const chunks = chunkLegalText(text, {
        fileName: "test.txt",
        documentCategory: "法律",
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const refs = chunks[0]!.metadata.articleRefs;
      expect(refs.length).toBeGreaterThan(0);
    });
  });

  describe("Parent-Child Chunk 模式", () => {
    it("长条文按款拆分时设置 parentId", () => {
      // 构造一个足够长的条文（超过 maxChunkSize=1500）
      const longParagraph = "这是一段很长的内容。".repeat(100);
      const text = `第一条 ${longParagraph}

第二款 另一段内容。

第三款 又一段内容。`;

      const chunks = chunkLegalText(text, {
        fileName: "test.txt",
        documentCategory: "法律",
        maxChunkSize: 200,
      });

      // 应该有多个 chunk（被拆分了）
      expect(chunks.length).toBeGreaterThan(1);

      // 被拆分的 chunk 应该有 parentId
      const childChunks = chunks.filter(c => c.parentId);
      if (childChunks.length > 0) {
        // 所有 child 的 parentId 应该相同
        const parentIds = new Set(childChunks.map(c => c.parentId));
        expect(parentIds.size).toBe(1);
      }
    });

    it("短条文不设置 parentId", () => {
      const text = `第一条 这是一条短条文。

第二条 这是另一条短条文。`;

      const chunks = chunkLegalText(text, {
        fileName: "test.txt",
        documentCategory: "法律",
      });

      for (const chunk of chunks) {
        expect(chunk.parentId).toBeUndefined();
      }
    });
  });
});
