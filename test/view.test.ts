import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readWikiGraph } from "../src/view/readWikiGraph.ts";
import { startViewServer } from "../src/view/server.ts";

/**
 * 创建独立 Wiki 测试目录，避免读取开发者当前的 wiki 内容。
 *
 * @returns 临时 Wiki 根目录。
 */
async function createWikiDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "llm-wiki-view-"));
  await mkdir(path.join(directory, "concepts"));
  return directory;
}

/**
 * 写入符合编译器格式的简化概念页。
 *
 * @param directory Wiki 根目录。
 * @param fileName 概念文件名。
 * @param title Frontmatter 标题。
 * @param relatedNames “相关概念”章节中的目标名称。
 * @param options 额外元数据或正文链接。
 */
async function writeConcept(
  directory: string,
  fileName: string,
  title: string,
  relatedNames: string[],
  options: { summary?: string; aliases?: string[]; bodyLink?: string } = {},
): Promise<void> {
  const aliases = options.aliases?.map((alias) => `  - ${alias}`).join("\n") ?? "";
  const markdown = `---
title: ${title}
summary: ${options.summary ?? ""}
tags:
  - 测试
aliases:${aliases ? `\n${aliases}` : " []"}
---

# ${title}

${options.bodyLink ? `正文提及 [[${options.bodyLink}]]` : "正文"}

## 相关概念

${relatedNames.map((name) => `- [[${name}]]`).join("\n")}

## 原文证据

- [[source.md:1-2]]
`;
  await writeFile(path.join(directory, "concepts", fileName), markdown, "utf8");
}

test("从 index 根节点放射建图：目录顺序、别名、摘要后备及概念关系去重", async () => {
  const directory = await createWikiDirectory();
  try {
    await writeConcept(directory, "alpha.md", "Alpha", ["Beta Alias", "Alpha", "Missing"], {
      bodyLink: "Gamma",
    });
    await writeConcept(directory, "beta.md", "Beta", ["Alpha"], {
      summary: "Beta 摘要",
      aliases: ["Beta Alias"],
    });
    await writeConcept(directory, "gamma.md", "Gamma", []);
    await writeFile(
      path.join(directory, "index.md"),
      "# 测试 Wiki\n\n- **[[Beta Alias]]** - index Beta 摘要\n- **[[Alpha]]** - index Alpha 摘要\n- [[Beta]] - 重复引用\n- **[[Orphan]]** - 无文件\n",
      "utf8",
    );

    const graph = await readWikiGraph(directory);
    assert.deepEqual(graph.nodes.map((node) => [node.kind, node.title]), [
      ["index", "测试 Wiki"], ["concept", "Beta"], ["concept", "Alpha"], ["concept", "Gamma"],
    ]);
    assert.equal(graph.nodes[1].summary, "Beta 摘要");
    assert.equal(graph.nodes[2].summary, "index Alpha 摘要");
    assert.deepEqual(graph.nodes[1].tags, ["测试"]);
    assert.deepEqual(graph.nodes[1].aliases, ["Beta Alias"]);
    assert.deepEqual(graph.edges.map((edge) => [edge.kind, edge.source, edge.target]), [
      ["directory", "wiki/index.md", "beta.md"],
      ["directory", "wiki/index.md", "alpha.md"],
      ["related", "alpha.md", "beta.md"],
    ]);
    assert.ok(graph.warnings.some((warning) => warning.includes("Orphan")));
    assert.ok(graph.warnings.some((warning) => warning.includes("Gamma")));
    assert.ok(graph.warnings.some((warning) => warning.includes("Missing")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("缺少或无有效目录项的 index 会报错，概念目录为空也会报错", async () => {
  const directory = await createWikiDirectory();
  try {
    await assert.rejects(readWikiGraph(directory), /没有有效的概念 Markdown/);
    await writeConcept(directory, "only.md", "Only", []);
    await assert.rejects(readWikiGraph(directory), /未找到 wiki\/index.md/);

    await writeFile(path.join(directory, "index.md"), "# llm-wiki\n\n0 pages\n", "utf8");
    await assert.rejects(readWikiGraph(directory), /没有有效目录项/);
    await writeFile(path.join(directory, "index.md"), "# llm-wiki\n\n[[Missing]]\n", "utf8");
    await assert.rejects(readWikiGraph(directory), /均未匹配/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("index 正文中的 Wiki 链接也会形成目录连线", async () => {
  const directory = await createWikiDirectory();
  try {
    await writeConcept(directory, "one.md", "One", []);
    await writeFile(path.join(directory, "index.md"), "# 自定义目录\n\n从 [[One]] 开始。\n", "utf8");
    const graph = await readWikiGraph(directory);
    assert.deepEqual(graph.edges.map((edge) => [edge.kind, edge.target]), [["directory", "one.md"]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("损坏的概念页给出提示，标准标题冲突时拒绝生成有歧义的图", async () => {
  const directory = await createWikiDirectory();
  try {
    await writeFile(path.join(directory, "concepts", "broken.md"), "# 缺少 Frontmatter\n", "utf8");
    await writeConcept(directory, "one.md", "One", []);
    await writeFile(path.join(directory, "index.md"), "# llm-wiki\n\n- [[One]]\n", "utf8");
    const graph = await readWikiGraph(directory);
    assert.equal(graph.nodes.length, 2);
    assert.ok(graph.warnings.some((warning) => warning.includes("broken.md")));

    await writeConcept(directory, "duplicate.md", "one", []);
    await assert.rejects(readWikiGraph(directory), /概念标题冲突/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("本地服务每次请求重读图数据，并仅提供固定的页面和脚本路径", async () => {
  const directory = await createWikiDirectory();
  const scriptPath = path.join(directory, "client.js");
  await writeConcept(directory, "one.md", "One", []);
  await writeFile(path.join(directory, "index.md"), "# 初始索引\n\n- [[One]]\n", "utf8");
  await writeFile(scriptPath, "console.log('view test');", "utf8");
  const view = await startViewServer(directory, scriptPath);

  try {
    const address = view.server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch(view.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /概念关系图/);
    const script = await fetch(new URL("/client.js", view.url));
    assert.equal(await script.text(), await readFile(scriptPath, "utf8"));

    const first = await fetch(new URL("/api/graph", view.url));
    const initial = await first.json();
    assert.equal(initial.nodes.length, 2);
    assert.equal(initial.nodes[0].title, "初始索引");
    await writeConcept(directory, "two.md", "Two", ["One"]);
    await writeFile(path.join(directory, "index.md"), "# 更新后索引\n\n- [[One]]\n- [[Two]]\n", "utf8");
    const second = await fetch(new URL("/api/graph", view.url));
    const updated = await second.json();
    assert.equal(updated.nodes.length, 3);
    assert.equal(updated.nodes[0].title, "更新后索引");
    assert.equal(updated.edges.filter((edge: { kind: string }) => edge.kind === "directory").length, 2);
    assert.equal(updated.edges.filter((edge: { kind: string }) => edge.kind === "related").length, 1);

    assert.equal((await fetch(new URL("/concepts/one.md", view.url))).status, 404);
    assert.equal((await fetch(new URL("/api/graph", view.url), { method: "POST" })).status, 405);
  } finally {
    await view.close();
    await rm(directory, { recursive: true, force: true });
  }
});
