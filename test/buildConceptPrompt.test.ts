import assert from "node:assert/strict";
import test from "node:test";
import { buildConceptExtractionMessages } from "../src/compile/buildConceptPrompt.ts";
import { SourceTypeEnum } from "../src/tools/shared.ts";
import type { SourceDocument } from "../src/types/document.ts";

const sourceDocument: SourceDocument = {
  filePath: "/project/sources/bitcoin.md",
  frontmatter: {
    title: "Bitcoin",
    source: "https://bitcoin.org/bitcoin.pdf",
    sourceType: SourceTypeEnum.OnlinePdf,
  },
  content: "Bitcoin uses a peer-to-peer network and proof-of-work.",
};

test("生成 system 和 user 两条概念提取消息", () => {
  const messages = buildConceptExtractionMessages(sourceDocument);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
});

test("Prompt 包含 source 文档的元数据和正文", () => {
  const messages = buildConceptExtractionMessages(sourceDocument);
  const userMessage = messages[1].content;

  assert.match(userMessage, /Bitcoin/);
  assert.match(userMessage, /https:\/\/bitcoin\.org\/bitcoin\.pdf/);
  assert.match(userMessage, /proof-of-work/);
});

test("Prompt 要求模型只返回合法 JSON", () => {
  const messages = buildConceptExtractionMessages(sourceDocument);
  const systemMessage = messages[0].content;

  assert.match(systemMessage, /只返回合法 JSON/);
  assert.match(systemMessage, /"concepts"/);
  assert.match(systemMessage, /"keyPoints"/);
  assert.match(systemMessage, /"evidence"/);
});

test("可以指定概念输出语言", () => {
  const messages = buildConceptExtractionMessages(sourceDocument, {
    outputLanguage: "简体中文",
  });

  assert.match(messages[0].content, /使用简体中文/);
});

test("参考表格属于可提取内容，正文中的联系方式不应被当作无关元数据", () => {
  const messages = buildConceptExtractionMessages({
    ...sourceDocument,
    frontmatter: {
      ...sourceDocument.frontmatter,
      title: "各地监管行协联系方式",
    },
    content: "| 机构 | 电话 |\n| --- | --- |\n| 北京监管局 | 010-66060530 |",
  });

  assert.match(messages[0].content, /文档主体就是机构名录、联系方式、对照表/);
  assert.match(messages[0].content, /保留原文中有用的名称、号码、网址和对应关系/);
  assert.match(messages[0].content, /不要断言它们目前仍然有效/);
  assert.match(messages[1].content, /010-66060530/);
});
