import { normalizeConceptName } from "@/utils/name";
import path from "path";

export enum SourceTypeEnum {
  /** 在线网页 */
  Web = 'web',
  /** 在线 PDF */
  OnlinePdf = 'onlinePdf'
}

/** 通用头部类型 */
export interface HeaderSource {
  /** 标题 */
  title?: string,
  /** 来源 */
  source?: string,
  /** 多个来源；与单数 source 兼容使用。 */
  sources?: string[],
  /** 发表时间 */
  publishedDate?: string,
  /** 来源类型 */
  sourceType?: SourceTypeEnum
  /** 允许额外自定义字段 */
  [key: string]: unknown
}

/** 用于提取 Markdown 文件顶部 YAML Frontmatter 的正则表达式。 */
export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * 从文件名提取可读的标题。
 *
 * 移除文件后缀，将短横线/下划线转换为空格，
 * 例如 "quarterly_report.pdf" 会转为 "quarterly report"。
 *
 * @param filePath - 源文件的路径。
 * @returns 人性化处理后的标题（保留小写，不含文件后缀）。
 */
export function titleFromFilename(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  return normalizeConceptName(basename)
}
