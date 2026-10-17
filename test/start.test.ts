import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { resolveStartInput } from "../src/start/resolveStartInput.ts";
import { importLocalMarkdown, importLocalText } from "../src/start/localText.ts";
import { SourceTypeEnum } from "../src/tools/shared.ts";

/** 从导入结果中读取 YAML 元数据和正文，验证生成文件可供 compile 使用。 */
function parseImportedFile(markdown: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  assert.ok(match, "导入结果应包含有效的 Frontmatter");
  return {
    frontmatter: parseYaml(match[1]) as Record<string, unknown>,
    content: match[2],
  };
}

test("start 按 URL 和本地文件扩展名选择处理器", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-route-")));
  try {
    const textPath = path.join(root, "NOTE.TXT");
    const markdownPath = path.join(root, "article.MD");
    await writeFile(textPath, "text", "utf8");
    await writeFile(markdownPath, "markdown", "utf8");

    assert.deepEqual(await resolveStartInput("https://example.com/article"), {
      kind: "web",
      value: "https://example.com/article",
    });
    assert.deepEqual(await resolveStartInput("https://example.com/report.PDF?download=1"), {
      kind: "onlinePdf",
      value: "https://example.com/report.PDF?download=1",
    });
    assert.deepEqual(await resolveStartInput(textPath), {
      kind: "localText",
      value: textPath,
    });
    assert.deepEqual(await resolveStartInput(markdownPath), {
      kind: "localMarkdown",
      value: markdownPath,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("start 对无效单文件输入给出明确错误", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-invalid-")));
  try {
    const pdfPath = path.join(root, "report.pdf");
    const otherPath = path.join(root, "report.csv");
    await writeFile(pdfPath, "pdf", "utf8");
    await writeFile(otherPath, "csv", "utf8");

    await assert.rejects(resolveStartInput("http://"), /无效的 HTTP\(S\) 地址/);
    await assert.rejects(resolveStartInput("ftp://example.com/file.txt"), /仅支持 HTTP\(S\)/);
    await assert.rejects(resolveStartInput(path.join(root, "missing.txt")), /本地文件不存在/);
    await assert.rejects(resolveStartInput(root), /不能导入目录/);
    await assert.rejects(resolveStartInput(pdfPath), /暂不支持本地 PDF/);
    await assert.rejects(resolveStartInput(otherPath), /不支持的本地文件类型：\.csv/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("本地 TXT 与 Markdown 导入内容和元数据", async (context) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-import-")));
  const previousCwd = process.cwd();
  process.chdir(root);

  try {
    await context.test("TXT 生成 Frontmatter，同一来源再次导入会更新内容", async () => {
      const filePath = path.join(root, "reading_notes.txt");
      await writeFile(filePath, "第一版内容", "utf8");
      await importLocalText(filePath);
      await writeFile(filePath, "第二版内容", "utf8");
      await importLocalText(filePath);

      assert.deepEqual(await readdir(path.join(root, "sources")), ["reading-notes.md"]);
      const result = parseImportedFile(await readFile(path.join(root, "sources", "reading-notes.md"), "utf8"));
      assert.equal(result.frontmatter.title, "reading-notes");
      assert.equal(result.frontmatter.source, filePath);
      assert.equal(result.frontmatter.sourceType, SourceTypeEnum.LocalText);
      assert.equal(result.content, "第二版内容");
    });

    await context.test("Markdown 原文作为正文，并生成 source 元数据", async () => {
      const filePath = path.join(root, "plain.md");
      await writeFile(filePath, "# 正文\n\n第二段", "utf8");
      await importLocalMarkdown(filePath);

      const result = parseImportedFile(await readFile(path.join(root, "sources", "plain.md"), "utf8"));
      assert.equal(result.frontmatter.title, "plain");
      assert.equal(result.frontmatter.source, filePath);
      assert.equal(result.frontmatter.sourceType, SourceTypeEnum.LocalMarkdown);
      assert.equal(result.content, "# 正文\n\n第二段");
    });

    await context.test("看似 Frontmatter 的内容也完整保留在正文中", async () => {
      const filePath = path.join(root, "existing.md");
      const content = "---\ntitle: 原标题\nsource: https://example.com/article\nsourceType: web\ntags:\n  - 知识\n---\n# 原正文\n";
      await writeFile(
        filePath,
        content,
        "utf8",
      );
      await importLocalMarkdown(filePath);

      const result = parseImportedFile(await readFile(path.join(root, "sources", "existing.md"), "utf8"));
      assert.equal(result.frontmatter.title, "existing");
      assert.equal(result.frontmatter.source, filePath);
      assert.equal(result.frontmatter.sourceType, SourceTypeEnum.LocalMarkdown);
      assert.equal(result.content, content);
    });

    await context.test("同名而来源不同的文件分别保留", async () => {
      const secondDirectory = path.join(root, "other");
      await mkdir(secondDirectory);
      const firstPath = path.join(root, "shared.txt");
      const secondPath = path.join(secondDirectory, "shared.txt");
      await writeFile(firstPath, "第一个来源", "utf8");
      await writeFile(secondPath, "第二个来源", "utf8");
      await importLocalText(firstPath);
      await importLocalText(secondPath);

      const files = (await readdir(path.join(root, "sources"))).filter((name) => name.startsWith("shared"));
      assert.equal(files.length, 2);
      const sources = await Promise.all(files.map(async (name) =>
        parseImportedFile(await readFile(path.join(root, "sources", name), "utf8")).frontmatter.source,
      ));
      assert.deepEqual(new Set(sources), new Set([firstPath, secondPath]));
    });

    await context.test("无效或未闭合的 YAML 样式文本也作为正文导入", async () => {
      const invalidYamlPath = path.join(root, "invalid.md");
      const unclosedPath = path.join(root, "unclosed.md");
      const invalidContent = "---\ntitle: [\n---\n正文";
      const unclosedContent = "---\ntitle: 标题\n正文";
      await writeFile(invalidYamlPath, invalidContent, "utf8");
      await writeFile(unclosedPath, unclosedContent, "utf8");

      await importLocalMarkdown(invalidYamlPath);
      await importLocalMarkdown(unclosedPath);
      const invalidResult = parseImportedFile(await readFile(path.join(root, "sources", "invalid.md"), "utf8"));
      const unclosedResult = parseImportedFile(await readFile(path.join(root, "sources", "unclosed.md"), "utf8"));
      assert.equal(invalidResult.content, invalidContent);
      assert.equal(unclosedResult.content, unclosedContent);
    });
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
