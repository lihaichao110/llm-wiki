import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { resolveStartInput } from "../src/start/resolveStartInput.ts";
import { extractLocalPdfText, importLocalPdf } from "../src/start/localPdf.ts";
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

/** 构造含可选标题和一页可提取文字的 PDF，避免测试依赖 OCR 下载。 */
function createTextPdf(title?: string): Buffer {
  const content = "BT /F1 18 Tf 40 100 Td (Readable PDF text) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    title ? `<< /Title (${title}) /CreationDate (D:20240102030405) >>` : "<< >>",
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
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test("start 按 URL 和本地文件扩展名选择处理器", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-route-")));
  try {
    const textPath = path.join(root, "NOTE.TXT");
    const markdownPath = path.join(root, "article.MD");
    const pdfPath = path.join(root, "report.PDF");
    await writeFile(textPath, "text", "utf8");
    await writeFile(markdownPath, "markdown", "utf8");
    await writeFile(pdfPath, createTextPdf());

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
    assert.deepEqual(await resolveStartInput(pdfPath), {
      kind: "localPdf",
      value: pdfPath,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("start 对无效单文件输入给出明确错误", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-invalid-")));
  try {
    const otherPath = path.join(root, "report.csv");
    await writeFile(otherPath, "csv", "utf8");

    await assert.rejects(resolveStartInput("http://"), /无效的 HTTP\(S\) 地址/);
    await assert.rejects(resolveStartInput("ftp://example.com/file.txt"), /仅支持 HTTP\(S\)/);
    await assert.rejects(resolveStartInput(path.join(root, "missing.txt")), /本地文件不存在/);
    assert.deepEqual(await resolveStartInput(root), { kind: "localDirectory", value: root });
    await assert.rejects(resolveStartInput(otherPath), /不支持的本地文件类型：\.csv/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("本地 PDF 使用元数据标题、来源路径，并在同名时跳过", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-local-pdf-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const pdfPath = path.join(root, "file.PDF");
    await writeFile(pdfPath, createTextPdf("Local PDF Title"));

    assert.equal(await importLocalPdf(pdfPath), "written");
    assert.equal(await importLocalPdf(pdfPath), "skipped");
    assert.deepEqual(await readdir(path.join(root, "sources")), ["Local-PDF-Title.md"]);

    const imported = parseImportedFile(await readFile(path.join(root, "sources", "Local-PDF-Title.md"), "utf8"));
    assert.equal(imported.frontmatter.title, "Local PDF Title");
    assert.equal(imported.frontmatter.source, pdfPath);
    assert.equal(imported.frontmatter.sourceType, SourceTypeEnum.LocalPdf);
    assert.equal(imported.frontmatter.publishedDate, "D:20240102030405");
    assert.equal(imported.content, "Readable PDF text");
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("本地 PDF 没有有效 Title 时使用文件名", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-pdf-name-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const pdfPath = path.join(root, "reading_notes.pdf");
    await writeFile(pdfPath, createTextPdf());
    const summary = await runStartImport(pdfPath, 2, true);
    assert.deepEqual(summary, { written: 1, skipped: 0, errors: [] });
    const imported = parseImportedFile(await readFile(path.join(root, "sources", "reading-notes.md"), "utf8"));
    assert.equal(imported.frontmatter.title, "reading-notes");
    assert.equal(imported.frontmatter.source, pdfPath);
    assert.equal(imported.content, "Readable PDF text");
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("本地 PDF 逐页补齐扫描页，并只创建一个 OCR worker", async () => {
  const recognizedPages: string[] = [];
  const renderedPages: number[] = [];
  let createCount = 0;
  let terminateCount = 0;
  const parser = {
    getText: async () => ({ pages: [
      { num: 1, text: "原生第一页" },
      { num: 2, text: "   " },
      { num: 3, text: "原生第三页" },
      { num: 4, text: "" },
    ] }),
    getScreenshot: async ({ partial }: { partial: number[] }) => {
      renderedPages.push(partial[0]);
      return { pages: [{ pageNumber: partial[0], data: Buffer.from([partial[0]]) }] };
    },
  };
  const content = await extractLocalPdfText(parser, async () => {
    createCount += 1;
    return {
      recognize: async (image: Buffer) => {
        recognizedPages.push(String(image[0]));
        return { data: { text: `OCR 第 ${image[0]} 页` } };
      },
      terminate: async () => { terminateCount += 1; },
    };
  });

  assert.equal(content, "原生第一页\n\nOCR 第 2 页\n\n原生第三页\n\nOCR 第 4 页");
  assert.deepEqual(renderedPages, [2, 4]);
  assert.deepEqual(recognizedPages, ["2", "4"]);
  assert.equal(createCount, 1);
  assert.equal(terminateCount, 1);
});

test("本地 PDF 的 OCR 失败仍释放 worker，空文档不产生正文", async () => {
  let terminated = false;
  const parser = {
    getText: async () => ({ pages: [{ num: 1, text: "" }] }),
    getScreenshot: async () => ({ pages: [{ pageNumber: 1, data: Buffer.from([1]) }] }),
  };
  await assert.rejects(extractLocalPdfText(parser, async () => ({
    recognize: async () => { throw new Error("OCR 失败"); },
    terminate: async () => { terminated = true; },
  })), /OCR 失败/);
  assert.equal(terminated, true);

  const emptyContent = await extractLocalPdfText(parser, async () => ({
    recognize: async () => ({ data: { text: "   " } }),
    terminate: async () => undefined,
  }));
  assert.equal(emptyContent, "");
});

test("本地 PDF 全文为空时不写入 source，重新导入可恢复", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-empty-pdf-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const pdfPath = path.join(root, "blank.pdf");
    await writeFile(pdfPath, createTinyPdf());
    const createWorker = (text: string) => async () => ({
      recognize: async () => ({ data: { text } }),
      terminate: async () => undefined,
    });

    await assert.rejects(importLocalPdf(pdfPath, createWorker(" ")), /PDF 无法提取正文/);
    assert.deepEqual(await readdir(path.join(root, "sources")), []);
    assert.equal(await importLocalPdf(pdfPath, createWorker("恢复后的文字")), "written");
    const imported = parseImportedFile(await readFile(path.join(root, "sources", "Known-Title.md"), "utf8"));
    assert.equal(imported.content, "恢复后的文字");
  } finally {
    process.chdir(previousCwd);
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
    await writeFile(path.join(root, "paper.PDF"), createTextPdf());
    await writeFile(path.join(root, "!!!.txt"), "无效标题", "utf8");
    await writeFile(path.join(root, "ignored.csv"), "忽略", "utf8");
    await writeFile(path.join(root, "sources", "existing.md"), "原有 source", "utf8");
    await symlink(path.join(root, "other.md"), path.join(root, "linked.md"));

    const summary = await runStartImport(root, 3, true);
    assert.equal(summary.written, 3);
    assert.equal(summary.skipped, 3);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].name, "!!!.txt");
    assert.deepEqual((await readdir(path.join(root, "sources"))).sort(), ["existing.md", "other.md", "paper.md", "shared.md"]);
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
