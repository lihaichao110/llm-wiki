import assert from "node:assert/strict";
import test from "node:test";
import { createProviderFromEnv } from "../src/providers/createProviderFromEnv";
import { OpenAICompatibleProvider } from "../src/providers/openAICompatible";

test("缺少或留空 LLM_BASE_URL 时在创建 Provider 前报错", () => {
  for (const baseURL of [undefined, "", "  \t "]) {
    assert.throws(
      () => createProviderFromEnv({ LLM_MODEL: "test-model", LLM_API_KEY: "test-key", LLM_BASE_URL: baseURL }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /缺少环境变量 LLM_BASE_URL/);
        assert.match(error.message, /https:\/\/api\.openai\.com\/v1/);
        return true;
      },
    );
  }
});

test("拒绝无效的 LLM_BASE_URL", () => {
  for (const baseURL of [
    "/v1",
    "https:example.com/v1",
    "ftp://example.com/v1",
    "https://example.com/v1?token=1",
    "https://example.com/v1?",
    "https://example.com/v1#fragment",
  ]) {
    assert.throws(
      () => createProviderFromEnv({ LLM_MODEL: "test-model", LLM_API_KEY: "test-key", LLM_BASE_URL: baseURL }),
      /LLM_BASE_URL 必须是有效的 http 或 https 绝对地址/,
    );
  }
});

test("显式 OpenAI 地址与自定义接口地址均可创建 Provider", () => {
  const openAIProvider = createProviderFromEnv({
    LLM_MODEL: "test-model",
    OPENAI_API_KEY: "test-key",
    LLM_BASE_URL: "https://api.openai.com/v1/",
  });
  const customProvider = createProviderFromEnv({
    LLM_MODEL: "test-model",
    LLM_BASE_URL: "http://localhost:11434/v1/",
  });

  assert.ok(openAIProvider instanceof OpenAICompatibleProvider);
  assert.ok(customProvider instanceof OpenAICompatibleProvider);
});

test("显式 OpenAI 地址仍要求提供密钥", () => {
  assert.throws(
    () => createProviderFromEnv({ LLM_MODEL: "test-model", LLM_BASE_URL: "https://api.openai.com/v1/" }),
    /需要设置 LLM_API_KEY 或 OPENAI_API_KEY/,
  );
});
