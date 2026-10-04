import { HeaderSource } from "@/tools/shared";

/**
 * source 文件的 Frontmatter 元数据。
 */
export interface SourceFrontmatter extends HeaderSource {
  /** 采集时间 */
  ingestedAt?: string;

  // 允许后续添加自定义 Frontmatter 字段。
  [key: string]: unknown;
}

/**
 * 编译阶段使用的完整 source 文档。
 */
export interface SourceDocument {
  /** 文件地址 */
  filePath: string;
  /** 格式化风格 */
  frontmatter: SourceFrontmatter;
  /** 正文内容 */
  content: string;
}