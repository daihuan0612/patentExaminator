import { describe, it, expect } from "vitest";

/**
 * 导入门控逻辑测试
 *
 * 测试文件导入时的必需文件检查逻辑。
 * 原来在 e2e-real.mjs 中作为非 HTTP 测试存在，现在移入单元测试。
 */

const REQUIRED_FILE_TYPES = ["reexam-request", "rejection-decision", "original-application"];

interface FileEntry {
  id: string;
  fileType: string;
  required: boolean;
}

/**
 * 检查是否所有必需文件都已上传
 */
function hasAllRequiredFiles(files: FileEntry[]): boolean {
  return REQUIRED_FILE_TYPES.every((type) => files.some((f) => f.fileType === type));
}

/**
 * 获取缺失的必需文件类型
 */
function getMissingRequiredFiles(files: FileEntry[]): string[] {
  return REQUIRED_FILE_TYPES.filter((type) => !files.some((f) => f.fileType === type));
}

/**
 * 检查是否有可选文件
 */
function hasOptionalFiles(files: FileEntry[]): boolean {
  return files.some((f) => f.fileType === "comparison-document");
}

describe("Import Gate", () => {
  describe("hasAllRequiredFiles", () => {
    it("returns false when files are missing", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
      ];
      expect(hasAllRequiredFiles(files)).toBe(false);
    });

    it("returns true when all required files are present", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
      ];
      expect(hasAllRequiredFiles(files)).toBe(true);
    });

    it("returns true when required files are present with optional files", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
        { id: "4", fileType: "comparison-document", required: false },
      ];
      expect(hasAllRequiredFiles(files)).toBe(true);
    });

    it("returns false when a required file is deleted", () => {
      let files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
      ];
      expect(hasAllRequiredFiles(files)).toBe(true);

      // 删除一个必需文件
      files = files.filter((f) => f.fileType !== "original-application");
      expect(hasAllRequiredFiles(files)).toBe(false);
    });
  });

  describe("getMissingRequiredFiles", () => {
    it("returns missing file types", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
      ];
      const missing = getMissingRequiredFiles(files);
      expect(missing).toHaveLength(2);
      expect(missing).toContain("rejection-decision");
      expect(missing).toContain("original-application");
    });

    it("returns empty array when all files are present", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
      ];
      const missing = getMissingRequiredFiles(files);
      expect(missing).toHaveLength(0);
    });
  });

  describe("hasOptionalFiles", () => {
    it("returns false when no optional files", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
      ];
      expect(hasOptionalFiles(files)).toBe(false);
    });

    it("returns true when optional file is present", () => {
      const files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
        { id: "4", fileType: "comparison-document", required: false },
      ];
      expect(hasOptionalFiles(files)).toBe(true);
    });
  });

  describe("deletion restores block", () => {
    it("blocks import after deleting required file", () => {
      let files: FileEntry[] = [
        { id: "1", fileType: "reexam-request", required: true },
        { id: "2", fileType: "rejection-decision", required: true },
        { id: "3", fileType: "original-application", required: true },
      ];

      // 初始状态：所有必需文件都存在
      expect(hasAllRequiredFiles(files)).toBe(true);

      // 删除一个必需文件
      files = files.filter((f) => f.fileType !== "original-application");

      // 删除后：应该被阻止
      expect(hasAllRequiredFiles(files)).toBe(false);

      // 缺失的文件应该被正确识别
      const missing = getMissingRequiredFiles(files);
      expect(missing).toContain("original-application");
    });
  });
});
