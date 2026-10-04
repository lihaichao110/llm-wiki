/** 判断字符串是否以 HTTP 或 HTTPS 协议开头。 */
export const isHttpUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

/**
 * 判断地址是否以 `.pdf` 后缀结尾。
 * 支持文件路径与在线地址，查询参数和锚点不会参与后缀判断。
 */
export const isPdfUrl = (value: string): boolean =>
  value.split(/[?#]/, 1)[0].toLowerCase().endsWith(".pdf");

/**
 * 判断未知值是不是普通对象。
 *
 * @param value 需要检查的值。
 * @returns 是否为普通对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
