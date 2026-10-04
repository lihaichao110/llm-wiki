import assert from "node:assert/strict";
import test from "node:test";
import { extractConceptsFromDocument } from "../src/compile/extractConcept.ts";
import type {
  LlmGenerateOptions,
  LlmProvider,
} from "../src/types/provider.ts";
import { SourceTypeEnum } from "../src/tools/shared.ts";
import type { SourceDocument } from "../src/types/document.ts";
import type { LlmMessage } from "../src/types/llm.ts";
import { ConceptMarkdownOptions } from "@/types/concept.ts";

const markdownOptions: ConceptMarkdownOptions = {
  sourceFileName: "bitcoin.md",
  modelId: "test-model",
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};

/**
 * 用于测试编译流程的假模型。
 */
class MockLlmProvider implements LlmProvider {
  /** 记录收到的消息，方便测试 Prompt 是否正确传递。 */
  receivedMessages: readonly LlmMessage[] = [];

  /** 记录模型是否被要求返回 JSON。 */
  receivedOptions: LlmGenerateOptions | undefined;

  /**
   * 返回固定的概念提取 JSON。
   */
  async generateText(
    messages: readonly LlmMessage[],
    options?: LlmGenerateOptions,
  ): Promise<string> {
    this.receivedMessages = messages;
    this.receivedOptions = options;

    return JSON.stringify({
      concepts: [
        {
          name: "Proof of Work",
          aliases: ["PoW"],
          summary: "A consensus mechanism based on computational work.",
          tags: ["blockchain", "consensus"],
          confidence: 0.95,
          content: "Proof of Work is a consensus mechanism used by [[Blockchain]] networks.",
          keyPoints: [
            "The longest chain represents the most accumulated work.",
          ],
          relatedConcepts: ["Blockchain"],
          evidence: [
            {
              text: "hash-based proof-of-work",
              startLine: 1,
              endLine: 1,
            },
          ],
        },
      ],
    });
  }
}

const sourceDocument: SourceDocument = {
  filePath: "/project/sources/bitcoin.md",
  frontmatter: {
    title: "Bitcoin",
    source: "https://bitcoin.org/bitcoin.pdf",
    sourceType: SourceTypeEnum.OnlinePdf,
  },
  content: "Bitcoin uses a hash-based proof-of-work system.",
};

test("完成一篇 source 文档的概念提取流程", async () => {
  const provider = new MockLlmProvider();

  const result = await extractConceptsFromDocument(
    sourceDocument,
    provider,
    markdownOptions
  );

  assert.equal(result.concepts.length, 1);
  assert.equal(result.concepts[0].name, "Proof of Work");

  assert.equal(provider.receivedMessages.length, 2);
  assert.match(
    provider.receivedMessages[1].content,
    /hash-based proof-of-work/,
  );

  assert.equal(provider.receivedOptions?.responseFormat, "json");
});

test("模型返回无效数据时拒绝概念提取结果", async () => {
  const invalidProvider: LlmProvider = {
    async generateText() {
      return "这不是 JSON";
    },
  };

  await assert.rejects(
    () =>
      extractConceptsFromDocument(
        sourceDocument,
        invalidProvider,
        markdownOptions
      ),
    /概念提取结果不是有效 JSON/,
  );
});