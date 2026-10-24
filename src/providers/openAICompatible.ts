import { LlmMessage } from "@/types/llm";
import { LlmGenerateOptions, LlmProvider } from "@/types/provider";

/** 未指定兼容接口地址时使用的 OpenAI 官方地址。 */
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** 默认地址鉴权或模型配置失败时给出的排查提示。 */
const DEFAULT_OPENAI_BASE_URL_HINT =
  "当前请求发送到了 OpenAI 默认接口。如果你使用的是其他服务商的模型或 API Key，请设置 LLM_BASE_URL 为该服务商的 OpenAI 兼容接口根地址；如果使用的是 OpenAI，请检查 LLM_API_KEY（或 OPENAI_API_KEY）和 LLM_MODEL。";

/**
 * 判断 404 响应是否明确表示模型不存在，避免将路径等其他 404 误判为模型配置问题。
 *
 * @param errorBody 接口返回的原始错误正文。
 * @returns 错误代码为 model_not_found 时返回 true。
 */
function isModelNotFoundError(errorBody: string): boolean {
  try {
    const payload = JSON.parse(errorBody) as { error?: { code?: unknown } };
    return payload.error?.code === "model_not_found";
  } catch {
    return false;
  }
}

/**
 * OpenAI 兼容接口配置。
 */
export interface OpenAICompatibleProviderOptions {
  /** 模型名称。 */
  model: string;

  /** API 密钥。本地模型服务可以不提供。 */
  apiKey?: string;

  /** API 根地址，默认使用 OpenAI。 */
  baseURL?: string;

  /** 自定义 fetch */
  fetchImplementation?: FetchFunction;
}

/**
 * 可替换的 fetch 函数类型，便于单元测试时模拟 HTTP 请求。
 */
export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * OpenAI Chat Completions 兼容响应中的消息。
 */
interface ChatCompletionChoice {
  message?: {
    content?: unknown;
  };
}

/**
 * OpenAI Chat Completions 兼容响应。
 */
interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

/**
 * 通过 OpenAI 兼容的 Chat Completions 接口调用大模型。
 */
export class OpenAICompatibleProvider implements LlmProvider {
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly baseURL: string;
  private readonly fetchImplementation: FetchFunction;

  /**
   * 创建 Provider。
   *
   * @param options 模型、密钥和接口地址配置。
   */
  constructor(options: OpenAICompatibleProviderOptions) {
    if (options.model.trim() === "") {
      throw new Error("模型名称不能为空");
    }

    this.model = options.model.trim();
    this.apiKey = options.apiKey?.trim();

    // 移除末尾斜杠，避免拼接地址时出现双斜杠。
    this.baseURL = (
      options.baseURL ?? DEFAULT_OPENAI_BASE_URL
    ).replace(/\/+$/, "");

    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch;
  }

  /**
   * 调用 OpenAI 兼容接口生成文本。
   *
   * @param messages 发送给模型的消息。
   * @param options 输出格式配置。
   * @returns 模型返回的消息正文。
   * @throws 接口返回失败状态或无效内容时抛出错误；默认 OpenAI 地址的鉴权或模型不存在错误会附带配置提示。
   */
  async generateText(messages: readonly LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
    };

    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    if (options?.responseFormat === "json") {
      requestBody.response_format = {
        type: "json_object",
      };
    }

    const response = await this.fetchImplementation(
      `${this.baseURL}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();

      // 限制错误正文长度，避免终端被超长响应占满。
      const shortErrorBody = errorBody.slice(0, 500);
      // 只有默认 OpenAI 地址上的鉴权或模型不存在错误才提示检查接口地址。
      const shouldSuggestBaseURL =
        this.baseURL === DEFAULT_OPENAI_BASE_URL &&
        (response.status === 401 ||
          (response.status === 404 && isModelNotFoundError(errorBody)));
      const configurationHint = shouldSuggestBaseURL
        ? `\n提示：${DEFAULT_OPENAI_BASE_URL_HINT}`
        : "";

      throw new Error(
        `大模型请求失败（HTTP ${response.status}）：${shortErrorBody}${configurationHint}`,
      );
    }

    let responseData: ChatCompletionResponse;

    try {
      responseData =
        (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new Error("大模型接口返回的内容不是有效 JSON");
    }

    const content = responseData.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("大模型接口没有返回有效的消息内容");
    }

    return content;
  }
}
