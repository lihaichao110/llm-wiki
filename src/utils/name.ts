import path from "node:path";

/**
 * 将概念名称转换成用于比较的标准键。
 */
export function normalizeConceptName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-");
}

/**
 * 从 source 文件路径中提取用于状态索引的文件名。
 *
 * @param filePath source 文件路径。
 * @returns 不包含父目录的文件名。
 */
export function extractFilePath(filePath: string) {
  return path.basename(filePath)
}