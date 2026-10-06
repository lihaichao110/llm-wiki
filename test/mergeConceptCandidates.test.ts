import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  mergeConceptCandidateGroups,
  mergeConceptCandidates,
} from "../src/compile/mergeConceptCandidates.ts";
import { replaceWikiConceptFiles } from "../src/compile/replaceWikiConceptFiles.ts";
import { ConceptCandidate, WikiConcept } from "../src/types/concept.ts";
import { LlmProvider } from "../src/types/provider.ts";
import { parse as parseYaml } from "yaml";

/** 创建测试用的完整概念候选。 */
const createCandidate = (
  name: string,
  sourceFileName: string,
  evidenceText = "evidence",
): ConceptCandidate => ({
  concept: {
    name,
    aliases: [],
    summary: `${name} summary`,
    tags: ["tag"],
    confidence: 0.9,
    keyPoints: ["point"],
    content: `${name} content`,
    relatedConcepts: [],
    evidence: [{ text: evidenceText, startLine: 1, endLine: 2 }],
  },
  sourceFileName,
  modelId: "test-model",
  extractedAt: "2026-10-06T00:00:00.000Z",
});

/** 创建可写入 Wiki 的测试概念。 */
const createWikiConcept = (name = "工作量证明"): WikiConcept => ({
  name,
  aliases: ["PoW"],
  summary: "一种共识机制。",
  tags: ["共识"],
  confidence: 0.95,
  keyPoints: ["需要计算工作"],
  content: "工作量证明是一种共识机制。",
  relatedConcepts: ["区块链"],
  sources: ["bitcoin.md"],
  evidence: [{
    sourceFileName: "bitcoin.md",
    text: "proof-of-work",
    startLine: 1,
    endLine: 2,
  }],
  modelId: "test-model",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});

/** 读取 Markdown 顶部的 YAML Frontmatter。 */
const readFrontmatter = async (filePath: string): Promise<Record<string, unknown>> => {
  const markdown = await readFile(filePath, "utf8");
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match);
  return parseYaml(match[1]) as Record<string, unknown>;
};

test("将三个规范化名称相同的候选放入同一平坦分组", () => {
  const candidates = [
    createCandidate(" Proof   Of Work ", "a.md"),
    createCandidate("proof_of_work", "b.md"),
    createCandidate("PROOF OF WORK", "c.md"),
  ];

  const groups = mergeConceptCandidates(candidates);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalizedName, "proof-of-work");
  assert.deepEqual(groups[0].candidates, candidates);
});

test("单候选直接转换，多候选只调用一次模型并保留来源证据", async () => {
  let callCount = 0;
  const provider: LlmProvider = {
    async generateText() {
      callCount += 1;
      return JSON.stringify({
        concept: {
          name: "Proof of Work",
          aliases: ["PoW"],
          summary: "Merged summary",
          tags: ["consensus"],
          confidence: 0.98,
          content: "Merged content",
          keyPoints: ["Merged point"],
          relatedConcepts: ["Blockchain"],
        },
      });
    },
  };
  const groups = mergeConceptCandidates([
    createCandidate("Unique", "unique.md"),
    createCandidate("Proof of Work", "a.md", "same"),
    createCandidate("proof_of_work", "b.md", "same"),
  ]);

  const concepts = await mergeConceptCandidateGroups(groups, provider);

  assert.equal(callCount, 1);
  assert.equal(concepts[0].name, "Unique");
  assert.equal(concepts[1].summary, "Merged summary");
  assert.deepEqual(concepts[1].sources, ["a.md", "b.md"]);
  assert.deepEqual(
    concepts[1].evidence.map((item) => item.sourceFileName),
    ["a.md", "b.md"],
  );
});

test("拒绝模型返回其他概念名称", async () => {
  const provider: LlmProvider = {
    async generateText() {
      return JSON.stringify({
        concept: {
          name: "Other Concept",
          aliases: [],
          summary: "summary",
          tags: [],
          confidence: 1,
          content: "content",
          keyPoints: [],
          relatedConcepts: [],
        },
      });
    },
  };
  const groups = mergeConceptCandidates([
    createCandidate("Proof of Work", "a.md"),
    createCandidate("proof_of_work", "b.md"),
  ]);

  await assert.rejects(
    mergeConceptCandidateGroups(groups, provider),
    /综合后的概念名称与原分组不一致/,
  );
});

test("全量替换保留 createdAt 并删除陈旧页面", async () => {
  const testRoot = await mkdtemp(path.join(process.cwd(), ".replace-wiki-test-"));
  const outputDirectory = path.join(testRoot, "concepts");
  const relativeOutputDirectory = path.relative(process.cwd(), outputDirectory);

  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, "工作量证明.md"),
      `---\ntitle: 工作量证明\ncreatedAt: 2020-01-01T00:00:00.000Z\n---\n\n旧正文`,
      "utf8",
    );
    await writeFile(path.join(outputDirectory, "陈旧页面.md"), "旧页面", "utf8");

    await replaceWikiConceptFiles([createWikiConcept()], {
      outputDirectory: relativeOutputDirectory,
    });

    assert.deepEqual(await readdir(outputDirectory), ["工作量证明.md"]);
    const frontmatter = await readFrontmatter(
      path.join(outputDirectory, "工作量证明.md"),
    );
    assert.equal(frontmatter.createdAt, "2020-01-01T00:00:00.000Z");
    assert.equal(frontmatter.updatedAt, "2026-10-06T00:00:00.000Z");
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("临时目录写入失败时保留原 Wiki", async () => {
  const testRoot = await mkdtemp(path.join(process.cwd(), ".replace-wiki-test-"));
  const outputDirectory = path.join(testRoot, "concepts");
  const relativeOutputDirectory = path.relative(process.cwd(), outputDirectory);

  try {
    await mkdir(outputDirectory, { recursive: true });
    const existingPath = path.join(outputDirectory, "existing.md");
    await writeFile(existingPath, "original", "utf8");
    const invalidConcept = { ...createWikiConcept(), sources: [] };

    await assert.rejects(
      replaceWikiConceptFiles([invalidConcept], {
        outputDirectory: relativeOutputDirectory,
      }),
      /source 或 sources 必须包含至少一个非空字符串/,
    );

    assert.equal(await readFile(existingPath, "utf8"), "original");
    assert.deepEqual(await readdir(outputDirectory), ["existing.md"]);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("有效的空概念快照会替换为空目录", async () => {
  const testRoot = await mkdtemp(path.join(process.cwd(), ".replace-wiki-test-"));
  const outputDirectory = path.join(testRoot, "concepts");
  const relativeOutputDirectory = path.relative(process.cwd(), outputDirectory);

  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, "old.md"), "old", "utf8");

    await replaceWikiConceptFiles([], { outputDirectory: relativeOutputDirectory });

    assert.deepEqual(await readdir(outputDirectory), []);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
