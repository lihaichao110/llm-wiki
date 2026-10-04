import { OpenAICompatibleProvider } from "./openAICompatible";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * 根据环境变量创建 OpenAI 兼容 Provider。
 *
 * 支持的环境变量：
 * - LLM_MODEL：必填，模型名称。
 * - LLM_API_KEY：通用接口密钥。
 * - OPENAI_API_KEY：LLM_API_KEY 不存在时的备用密钥。
 * - LLM_BASE_URL：可选，兼容服务地址。
 *
 * @param environment 环境变量，默认读取当前进程环境。
 * @returns 配置完成的 Provider。
 */
export function createProviderFromEnv(environment: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider {
  const model = environment.LLM_MODEL?.trim();

  if (!model) {
    throw new Error("缺少环境变量 LLM_MODEL");
  }

  const baseURL =
    environment.LLM_BASE_URL?.trim() ||
    DEFAULT_OPENAI_BASE_URL;

  const apiKey =
    environment.LLM_API_KEY?.trim() ||
    environment.OPENAI_API_KEY?.trim();

  // OpenAI 官方接口必须提供密钥，本地兼容服务则可以不提供。
  const normalizedBaseURL = baseURL.replace(/\/+$/, "");

  if (
    normalizedBaseURL === DEFAULT_OPENAI_BASE_URL &&
    !apiKey
  ) {
    throw new Error(
      "使用 OpenAI 官方接口时，需要设置 LLM_API_KEY 或 OPENAI_API_KEY",
    );
  }

  return new OpenAICompatibleProvider({
    model,
    apiKey,
    baseURL,
  });
}