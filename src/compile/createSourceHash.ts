import { createHash } from "node:crypto";

/**
 * 计算 source 内容快照的稳定 SHA-256 哈希。
 *
 * 对规范化的 Frontmatter 和正文序列化，供成功状态记录使用。
 *
 * @param config source 的 Frontmatter 与正文。
 * @returns SHA-256 十六进制哈希。
 * @throws 缺少配置参数时抛出错误。
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
