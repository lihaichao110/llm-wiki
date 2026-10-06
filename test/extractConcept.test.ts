import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  extractAllConcepts,
  extractConceptsFromDocument,
} from "../src/compile/extractConcept.ts";
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
  assert.equal(provider.receivedOptions?.temperature, 0);
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

test("按指定并发量提取全部概念并保持文档顺序", async () => {
  /** 当前正在执行的模型请求数量。 */
  let activeRequests = 0;
  /** 测试期间观测到的最大并发请求数量。 */
  let maximumActiveRequests = 0;

  const provider: LlmProvider = {
    async generateText(messages) {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);

      const sourceName = messages[1].content.match(/document-(\d+)/)?.[1] ?? "unknown";
      // 让靠前文档更晚完成，验证返回顺序不受请求完成顺序影响。
      await new Promise((resolveDelay) => setTimeout(resolveDelay, sourceName === "0" ? 20 : 5));
      activeRequests -= 1;

      return JSON.stringify({
        concepts: [
          {
            name: `Concept ${sourceName}`,
            aliases: [],
            summary: `Summary ${sourceName}`,
            tags: [],
            confidence: 1,
            content: `Content ${sourceName}`,
            keyPoints: [],
            relatedConcepts: [],
            evidence: [],
          },
        ],
      });
    },
  };

  const documents: SourceDocument[] = [0, 1, 2].map((index) => ({
    filePath: path.resolve(process.cwd(), "sources", `document-${index}.md`),
    frontmatter: {
      title: `Document ${index}`,
      source: `https://example.com/${index}`,
      sourceType: SourceTypeEnum.Web,
    },
    content: `document-${index}`,
  }));

  const candidates = await extractAllConcepts(documents, provider, {
    concurrency: 2,
    modelId: "test-model",
    extractedAt: "2026-10-06T00:00:00.000Z",
  });

  assert.equal(maximumActiveRequests, 2);
  assert.deepEqual(
    candidates.map((candidate) => candidate.concept.name),
    ["Concept 0", "Concept 1", "Concept 2"],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceFileName),
    ["document-0.md", "document-1.md", "document-2.md"],
  );
});

test("拒绝无效的批量提取并发量", async () => {
  const provider = new MockLlmProvider();

  await assert.rejects(
    extractAllConcepts([], provider, {
      concurrency: 0,
      modelId: "test-model",
    }),
    /并行提取数量必须是大于等于 1 的安全整数/,
  );
});
