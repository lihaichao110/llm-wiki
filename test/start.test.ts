import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { resolveStartInput } from "../src/start/resolveStartInput.ts";
import { importLocalMarkdown, importLocalText } from "../src/start/localText.ts";
import { processNamedSource } from "../src/start/processNamedSource.ts";
import { runStartImport } from "../src/start/runStartImport.ts";
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

/** 生成带标题元数据的最小 PDF，验证在线 PDF 的标题判重入口。 */
function createTinyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    "<< /Title (Known Title) >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
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
    assert.deepEqual(await resolveStartInput(root), { kind: "localDirectory", value: root });
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
    await context.test("TXT 生成 Frontmatter，同一来源再次导入会跳过", async () => {
      const filePath = path.join(root, "reading_notes.txt");
      await writeFile(filePath, "第一版内容", "utf8");
      assert.equal(await importLocalText(filePath), "written");
      await writeFile(filePath, "第二版内容", "utf8");
      assert.equal(await importLocalText(filePath), "skipped");

      assert.deepEqual(await readdir(path.join(root, "sources")), ["reading-notes.md"]);
      const result = parseImportedFile(await readFile(path.join(root, "sources", "reading-notes.md"), "utf8"));
      assert.equal(result.frontmatter.title, "reading-notes");
      assert.equal(result.frontmatter.source, filePath);
      assert.equal(result.frontmatter.sourceType, SourceTypeEnum.LocalText);
      assert.equal(result.content, "第一版内容");
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

    await context.test("同名而来源不同的文件不再生成哈希副本", async () => {
      const secondDirectory = path.join(root, "other");
      await mkdir(secondDirectory);
      const firstPath = path.join(root, "shared.txt");
      const secondPath = path.join(secondDirectory, "shared.txt");
      await writeFile(firstPath, "第一个来源", "utf8");
      await writeFile(secondPath, "第二个来源", "utf8");
      assert.equal(await importLocalText(firstPath), "written");
      assert.equal(await importLocalText(secondPath), "skipped");

      const files = (await readdir(path.join(root, "sources"))).filter((name) => name.startsWith("shared"));
      assert.deepEqual(files, ["shared.md"]);
      const result = parseImportedFile(await readFile(path.join(root, "sources", files[0]), "utf8"));
      assert.equal(result.frontmatter.source, firstPath);
      assert.equal(result.content, "第一个来源");
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

test("目录递归导入展示跳过项，并在单项失败后继续", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-folder-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "b"));
    await mkdir(path.join(root, "sources"));
    await writeFile(path.join(root, "a", "shared.txt"), "第一份", "utf8");
    await writeFile(path.join(root, "b", "shared.md"), "第二份", "utf8");
    await writeFile(path.join(root, "other.md"), "另一份", "utf8");
    await writeFile(path.join(root, "!!!.txt"), "无效标题", "utf8");
    await writeFile(path.join(root, "ignored.csv"), "忽略", "utf8");
    await writeFile(path.join(root, "sources", "existing.md"), "原有 source", "utf8");
    await symlink(path.join(root, "other.md"), path.join(root, "linked.md"));

    const summary = await runStartImport(root, 3, true);
    assert.equal(summary.written, 2);
    assert.equal(summary.skipped, 3);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].name, "!!!.txt");
    assert.deepEqual((await readdir(path.join(root, "sources"))).sort(), ["existing.md", "other.md", "shared.md"]);
    const shared = parseImportedFile(await readFile(path.join(root, "sources", "shared.md"), "utf8"));
    assert.equal(shared.content, "第一份");
    assert.equal(await readFile(path.join(root, "sources", "existing.md"), "utf8"), "原有 source");
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("网页取得标题后跳过已有同名 source", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-web-skip-")));
  const previousCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  process.chdir(root);
  try {
    await mkdir(path.join(root, "sources"));
    const existingPath = path.join(root, "sources", "same-title.md");
    await writeFile(existingPath, "已有文章", "utf8");
    globalThis.fetch = async () => new Response(
      "<!doctype html><html><head><title>Same Title</title></head><body><article><h1>Same Title</h1><p>" +
      "This article has enough text for the readability parser to identify its main content. ".repeat(5) +
      "</p></article></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );

    const summary = await runStartImport("https://example.com/article", 3, true);
    assert.equal(summary.written, 0);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(summary.errors, []);
    assert.equal(await readFile(existingPath, "utf8"), "已有文章");
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("在线 PDF 取得标题后跳过已有同名 source", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-pdf-skip-")));
  const previousCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  process.chdir(root);
  try {
    await mkdir(path.join(root, "sources"));
    const existingPath = path.join(root, "sources", "Known-Title.md");
    await writeFile(existingPath, "已有 PDF", "utf8");
    const pdf = createTinyPdf();
    globalThis.fetch = async () => new Response(pdf.toString("ascii"), { status: 200 });

    const summary = await runStartImport("https://example.com/report.pdf", 3, true);
    assert.equal(summary.written, 0);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(summary.errors, []);
    assert.equal(await readFile(existingPath, "utf8"), "已有 PDF");
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("同名任务失败后释放队列，写入前出现的同名文件不会被覆盖", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-race-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const frontmatter = { title: "race", source: "test://race" };
    const first = processNamedSource("race", () => {
      throw new Error("正文生成失败");
    }, frontmatter);
    const second = processNamedSource("race", () => "第二项正文", frontmatter);
    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0].status, "rejected");
    assert.deepEqual(results[1], { status: "fulfilled", value: "written" });

    const racePath = path.join(root, "sources", "other.md");
    const result = await processNamedSource("other", async () => {
      await writeFile(racePath, "其他进程写入", "utf8");
      return "本轮正文";
    }, { title: "other", source: "test://other" });
    assert.equal(result, "skipped");
    assert.equal(await readFile(racePath, "utf8"), "其他进程写入");
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});
