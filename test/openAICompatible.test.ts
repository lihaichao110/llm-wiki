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
      temperature: 0,
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
  assert.equal(requestedBody?.temperature, 0);

  assert.deepEqual(requestedBody?.response_format, {
    type: "json_object",
  });
});

test("默认 OpenAI 地址鉴权失败时保留原始错误并提示配置接口地址", async () => {
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
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /大模型请求失败（HTTP 401）/);
      assert.match(error.message, /invalid api key/);
      assert.match(error.message, /LLM_BASE_URL/);
      assert.match(error.message, /LLM_API_KEY/);
      return true;
    },
  );
});

test("默认 OpenAI 地址返回模型不存在时提示配置接口地址", async () => {
  const provider = new OpenAICompatibleProvider({
    model: "other-provider-model",
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({ error: { code: "model_not_found", message: "model not found" } }),
        { status: 404 },
      ),
  });

  await assert.rejects(
    () => provider.generateText([{ role: "user", content: "测试" }]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /model not found/);
      assert.match(error.message, /LLM_BASE_URL/);
      return true;
    },
  );
});

test("自定义接口地址失败时不追加默认地址提示", async () => {
  for (const status of [401, 404]) {
    const provider = new OpenAICompatibleProvider({
      model: "test-model",
      baseURL: "https://example.com/v1",
      fetchImplementation: async () =>
        new Response(JSON.stringify({ error: { code: "model_not_found" } }), { status }),
    });

    await assert.rejects(
      () => provider.generateText([{ role: "user", content: "测试" }]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /LLM_BASE_URL/);
        return true;
      },
    );
  }
});

test("其他错误不追加接口地址提示", async () => {
  for (const [status, body] of [
    [404, JSON.stringify({ error: { code: "not_found" } })],
    [429, JSON.stringify({ error: { code: "rate_limit_exceeded" } })],
  ] as const) {
    const provider = new OpenAICompatibleProvider({
      model: "test-model",
      fetchImplementation: async () => new Response(body, { status }),
    });

    await assert.rejects(
      () => provider.generateText([{ role: "user", content: "测试" }]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /LLM_BASE_URL/);
        return true;
      },
    );
  }
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
