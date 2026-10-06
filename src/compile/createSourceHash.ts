import { createHash } from "node:crypto";

/**
 * 计算 source 文件的稳定 SHA-256 哈希。
 *
 * 直接使用文件原始字节，确保正文或 Frontmatter 的任何变化
 * 都会触发重新编译。
 *
 * @param filePath source 文件的绝对路径。
 * @returns 带算法前缀的十六进制哈希。
 * @throws 文件不存在或无法读取时抛出文件系统异常。
 */
export function createSourceHash(
  config: Record<string, unknown>,
): string {
  if (!config) {
    throw new Error('缺少关键参数：config')
  }

  const configValue = JSON.stringify(config)

  const hash = createHash("sha256")
    .update(configValue, 'utf-8')
    .digest("hex");

  return hash;
}