import assert from "node:assert/strict";
import test from "node:test";
import { parseConceptExtractionJson } from "../src/compile/parseConceptExtraction.ts";
import { ConceptMarkdownOptions } from "@/types/concept.ts";

const markdownOptions: ConceptMarkdownOptions = {
  sourceFileName: "bitcoin.md",
  modelId: "test-model",
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};

test("解析有效的概念提取结果", () => {
  const rawJson = JSON.stringify({
    concepts: [
      {
        name: "工作量证明",
        aliases: ["Proof of Work", "PoW"],
        summary: "一种通过计算工作保护网络共识的机制。",
        tags: ["区块链", "共识机制"],
        confidence: 0.95,
        content: "工作量证明是一种用于保护[[区块链]]网络的共识机制。",
        keyPoints: ["参与者需要完成计算工作"],
        relatedConcepts: ["区块链"],
        evidence: [
          {
            text: "hash-based proof-of-work",
            startLine: 1,
            endLine: 1,
          },
        ],
      },
    ]
  });

  const result = parseConceptExtractionJson(rawJson, markdownOptions);

  assert.equal(result.concepts.length, 1);
  assert.equal(result.concepts[0].name, "工作量证明");
  assert.deepEqual(result.concepts[0].aliases, ["Proof of Work", "PoW"]);
});

test("拒绝不是 JSON 的模型输出", () => {
  assert.throws(
    () => parseConceptExtractionJson("这不是 JSON", markdownOptions),
    /概念提取结果不是有效 JSON/,
  );
});

test("拒绝缺少 concepts 数组的结果", () => {
  assert.throws(
    () => parseConceptExtractionJson('{"concepts":"工作量证明"}', markdownOptions),
    /concepts 必须是数组/,
  );
});

test("拒绝字段格式不正确的概念", () => {
  const rawJson = JSON.stringify({
    concepts: [
      {
        name: "",
        aliases: [],
        summary: "测试概念",
        keyPoints: [],
        relatedConcepts: [],
        evidence: [],
      },
    ],
  });

  assert.throws(
    () => parseConceptExtractionJson(rawJson, markdownOptions),
    /concepts\[0\]\.name 必须是非空字符串/,
  );
});