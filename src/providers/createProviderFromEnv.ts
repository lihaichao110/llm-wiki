import { OpenAICompatibleProvider } from "./openAICompatible";

/** 用于识别官方接口并指明 OpenAI 用户应填写的地址。 */
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** 接口根地址格式错误时统一使用的提示。 */
const INVALID_BASE_URL_MESSAGE = "LLM_BASE_URL 必须是有效的 http 或 https 绝对地址，且不能包含查询参数或片段";

/**
 * 根据环境变量创建 OpenAI 兼容 Provider。
 *
 * 支持的环境变量：
 * - LLM_MODEL：必填，模型名称。
 * - LLM_API_KEY：通用接口密钥。
 * - OPENAI_API_KEY：LLM_API_KEY 不存在时的备用密钥。
 * - LLM_BASE_URL：必填，OpenAI 或其他服务商的兼容接口根地址。
 *
 * @param environment 环境变量，默认读取当前进程环境。
 * @returns 配置完成的 Provider。
 * @throws 模型、接口地址或 OpenAI 官方接口密钥缺失，以及接口地址格式无效时抛出错误。
 */
export function createProviderFromEnv(environment: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider {
  const model = environment.LLM_MODEL?.trim();

  if (!model) {
    throw new Error("缺少环境变量 LLM_MODEL");
  }

  const baseURL = environment.LLM_BASE_URL?.trim();

  if (!baseURL) {
    throw new Error(
      `缺少环境变量 LLM_BASE_URL。使用 OpenAI 时请设置为 ${DEFAULT_OPENAI_BASE_URL}；使用其他服务时请填写该服务的 OpenAI 兼容接口根地址。`,
    );
  }

  let parsedBaseURL: URL;
  try {
    parsedBaseURL = new URL(baseURL);
  } catch {
    throw new Error(INVALID_BASE_URL_MESSAGE);
  }

  // 接口根地址会继续拼接 /chat/completions，查询参数和片段会破坏最终请求路径。
  if (
    !/^https?:\/\//i.test(baseURL) ||
    !["http:", "https:"].includes(parsedBaseURL.protocol) ||
    baseURL.includes("?") ||
    baseURL.includes("#")
  ) {
    throw new Error(INVALID_BASE_URL_MESSAGE);
  }

  const apiKey =
    environment.LLM_API_KEY?.trim() ||
    environment.OPENAI_API_KEY?.trim();

  // OpenAI 官方接口必须提供密钥，本地兼容服务则可以不提供。
  const normalizedBaseURL = parsedBaseURL.href.replace(/\/+$/, "");

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
