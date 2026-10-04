import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAICompatibleProvider,
  type FetchFunction,
} from "../src/providers/openAICompatible";

test("向 OpenAI 兼容接口发送消息并返回文本", async () => {
  let requestedURL = "";
  let requestedAuthorization: string | null = null;
  let requestedBody: Record<string, unknown> | undefined;

  const mockFetch: FetchFunction = async (input: any, init: any) => {
    requestedURL = String(input);
    requestedAuthorization = new Headers(
      init?.headers,
    ).get("Authorization");

    requestedBody = JSON.parse(
      String(init?.body),
    ) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"concepts":[]}',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  const provider = new OpenAICompatibleProvider({
    model: "test-model",
    apiKey: "test-api-key",
    baseURL: "https://example.com/v1/",
    fetchImplementation: mockFetch,
  });

  const result = await provider.generateText(
    [
      {
        role: "user",
        content: "请返回 JSON",
      },
    ],
    {
      responseFormat: "json",
    },
  );

  assert.equal(result, '{"concepts":[]}');

  assert.equal(
    requestedURL,
    "https://example.com/v1/chat/completions",
  );

  assert.equal(
    requestedAuthorization,
    "Bearer test-api-key",
  );

  assert.equal(requestedBody?.model, "test-model");

  assert.deepEqual(requestedBody?.response_format, {
    type: "json_object",
  });
});

test("接口返回失败状态时抛出明确错误", async () => {
  const mockFetch: FetchFunction = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "invalid api key",
        },
      }),
      {
        status: 401,
      },
    );

  const provider = new OpenAICompatibleProvider({
    model: "test-model",
    fetchImplementation: mockFetch,
  });

  await assert.rejects(
    () =>
      provider.generateText([
        {
          role: "user",
          content: "测试",
        },
      ]),
    /大模型请求失败（HTTP 401）/,
  );
});

test("接口没有返回消息正文时抛出错误", async () => {
  const mockFetch: FetchFunction = async () =>
    new Response(
      JSON.stringify({
        choices: [],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

  const provider = new OpenAICompatibleProvider({
    model: "test-model",
    fetchImplementation: mockFetch,
  });

  await assert.rejects(
    () =>
      provider.generateText([
        {
          role: "user",
          content: "测试",
        },
      ]),
    /没有返回有效的消息内容/,
  );
});