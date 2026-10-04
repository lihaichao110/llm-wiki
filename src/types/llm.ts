/**
 * 大模型消息支持的角色。
 */
export type LlmMessageRole = "system" | "user";

/**
 * 与具体模型供应商无关的消息格式。
 */
export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}