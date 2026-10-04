import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { writeConceptFiles } from "../src/compile/writeConceptFile.ts";
import { ExtractedConcept } from "../src/types/concept.ts";
import { writeMarkdownFile } from "../src/utils/writeMarkdownFile.ts";
import { parse } from "yaml";

/** 创建位于当前工作目录内、符合 Markdown 写入安全约束的测试目录。 */
const createTestDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(process.cwd(), ".write-markdown-test-"));
  return path.relative(process.cwd(), directory);
};

/** 从完整 Markdown 文本中解析 YAML Frontmatter。 */
const parseFrontmatter = (markdown: string): Record<string, unknown> => {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, "Markdown 应包含 Frontmatter");
  return parse(match[1]) as Record<string, unknown>;
};

/** 创建用于验证概念写入行为的最小完整概念。 */
const createConcept = (summary: string): ExtractedConcept => ({
  name: "工作量证明",
  aliases: ["PoW"],
  summary,
  tags: ["共识机制"],
  confidence: 0.95,
  keyPoints: [],
  content: "",
  relatedConcepts: [],
  evidence: [],
});

test("概念文件使用 sources 数组且不要求单数 source", async () => {
  const directory = await createTestDirectory();

  try {
    await writeConceptFiles(
      [createConcept("第一版摘要")],
      {
        sourceFileName: "bitcoin.md",
        modelId: "test-model",
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      },
      directory,
    );

    const markdown = await readFile(
      path.join(process.cwd(), directory, "工作量证明.md"),
      "utf8",
    );
    const frontmatter = parseFrontmatter(markdown);

    assert.deepEqual(frontmatter.sources, ["bitcoin.md"]);
    assert.equal("source" in frontmatter, false);
  } finally {
    await rm(path.join(process.cwd(), directory), { recursive: true, force: true });
  }
});

test("重复的复数来源会去重后生成来源标识", async () => {
  const directory = await createTestDirectory();

  try {
    await writeMarkdownFile("同名文章", "第一版", {
      directory,
      frontmatter: { title: "同名文章", sources: ["a", "a", "b"] },
    });
    await writeMarkdownFile("同名文章", "第二版", {
      directory,
      frontmatter: { title: "同名文章", sources: ["a", "b"] },
    });

    const files = await readdir(path.join(process.cwd(), directory));
    assert.deepEqual(files, ["同名文章.md"]);

    const markdown = await readFile(
      path.join(process.cwd(), directory, "同名文章.md"),
      "utf8",
    );
    assert.match(markdown, /第二版/);
  } finally {
    await rm(path.join(process.cwd(), directory), { recursive: true, force: true });
  }
});

test("单数 source 保持原有哈希并与单元素 sources 兼容", async () => {
  const directory = await createTestDirectory();

  try {
    await writeMarkdownFile("同名文章", "第一篇", {
      directory,
      frontmatter: { title: "同名文章", source: "https://example.com/first" },
    });
    await writeMarkdownFile("同名文章", "第一篇更新", {
      directory,
      frontmatter: { title: "同名文章", sources: ["https://example.com/first"] },
    });
    await writeMarkdownFile("同名文章", "第二篇", {
      directory,
      frontmatter: { title: "同名文章", source: "https://example.com/second" },
    });

    const files = await readdir(path.join(process.cwd(), directory));
    const secondSourceHash = createHash("sha256")
      .update("https://example.com/second")
      .digest("hex")
      .slice(0, 8);
    assert.equal(files.length, 2);
    assert.ok(files.includes("同名文章.md"));
    assert.ok(files.includes(`同名文章-${secondSourceHash}.md`));
  } finally {
    await rm(path.join(process.cwd(), directory), { recursive: true, force: true });
  }
});

test("缺少有效的 source 和 sources 时拒绝写入", async () => {
  const directory = await createTestDirectory();

  try {
    await assert.rejects(
      writeMarkdownFile("缺少来源", "正文", {
        directory,
        frontmatter: { title: "缺少来源", sources: ["", "  "] },
      }),
      /source 或 sources 必须包含至少一个非空字符串/,
    );
  } finally {
    await rm(path.join(process.cwd(), directory), { recursive: true, force: true });
  }
});
