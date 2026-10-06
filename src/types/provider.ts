import type { LlmMessage } from "@/types/llm";

/**
 * 调用大模型时的生成配置。
 */
export interface LlmGenerateOptions {
  /**
   * 模型生成时使用的采样温度。
   *
   * 数值越低，模型输出通常越稳定；具体取值范围由 Provider 决定。
   */
  temperature?: number;

  /**
   * 希望模型返回的数据格式。
   *
   * provider 可以根据这个配置启用对应厂商的 JSON 输出功能。
   */
  responseFormat?: "text" | "json";
}

/**
 * 与具体模型厂商无关的大模型接口。
 */
export interface LlmProvider {
  /**
   * 根据消息生成文本。
   *
   * @param messages 发送给大模型的消息。
   * @param options 生成配置。
   * @returns 模型返回的原始文本。
   */
  generateText(
    messages: readonly LlmMessage[],
    options?: LlmGenerateOptions,
  ): Promise<string>;
}
