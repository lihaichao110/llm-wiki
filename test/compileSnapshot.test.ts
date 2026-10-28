import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileDocuments } from "../src/compile/compileDocuments.ts";
import { publishSnapshot, StagedArtifact } from "../src/compile/publishSnapshot.ts";
import { readAllDocuments } from "../src/compile/readSources.ts";
import { LlmProvider } from "../src/types/provider.ts";

/** 在仓库内创建独立目录，以测试命令实际使用的相对输出路径。 */
async function createProject() {
  const root = await mkdtemp(path.join(process.cwd(), ".compile-test-"));
  const sourcesDirectory = path.relative(process.cwd(), path.join(root, "sources"));
  const outputDirectory = path.relative(process.cwd(), path.join(root, "wiki", "concepts"));
  const stateFilePath = path.relative(process.cwd(), path.join(root, ".llmwiki", "state.json"));
  await mkdir(path.join(root, "sources"), { recursive: true });
  return { root, sourcesDirectory, outputDirectory, stateFilePath };
}

/** 用标题生成固定的有效模型结果，并可模拟提取或合并失败。 */
function createProvider(mode: "success" | "extract-error" | "merge-error" = "success"): LlmProvider {
  return {
    async generateText(messages) {
      if (mode === "extract-error") throw new Error("模型提取失败");
      const userMessage = messages[1].content;
      if (userMessage.includes("请综合下面")) {
        if (mode === "merge-error") throw new Error("模型合并失败");
        const name = "共享概念";
        return JSON.stringify({ concept: {
          name, aliases: [], summary: name, tags: [], confidence: 1,
          content: name, keyPoints: [], relatedConcepts: [],
        } });
      }
      const title = userMessage.match(/"title":\s*"([^\"]+)"/)?.[1] ?? "未知概念";
      return JSON.stringify({ concepts: [{
        name: title, aliases: [], summary: title, tags: [], confidence: 1,
        content: title, keyPoints: [], relatedConcepts: [], evidence: [],
      }] });
    },
  };
}

/** 写入具备有效 Frontmatter 的资料。 */
async function writeSource(root: string, name: string, title: string, body = title) {
  const filePath = path.join(root, "sources", name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `---\ntitle: ${title}\nsource: local\nsourceType: localMarkdown\n---\n\n${body}`, "utf8");
}

/** 对测试项目运行一轮完整编译。 */
async function compileProject(project: Awaited<ReturnType<typeof createProject>>, provider = createProvider()) {
  const documents = await readAllDocuments(project.sourcesDirectory);
  return compileDocuments(documents, provider, {
    concurrency: 2, modelId: "test-model",
    sourcesDirectory: project.sourcesDirectory,
    outputDirectory: project.outputDirectory,
    stateFilePath: project.stateFilePath,
  });
}

test("重复编译、局部修改和删除资料均生成完整快照", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "概念甲");
    await writeSource(project.root, "b.md", "概念乙");
    await compileProject(project);
    // 旧版以 basename 为键；下一轮成功状态必须整体替换，不能保留陈旧记录。
    await writeFile(path.join(project.root, ".llmwiki", "state.json"),
      JSON.stringify({ sources: { "legacy.md": { hash: "old" } } }), "utf8");
    await compileProject(project);
    const migratedState = JSON.parse(await readFile(path.join(project.root, ".llmwiki", "state.json"), "utf8"));
    assert.deepEqual(Object.keys(migratedState.sources), ["a.md", "b.md"]);
    await writeSource(project.root, "a.md", "概念甲", "修改后的内容");
    await compileProject(project);
    assert.deepEqual((await readdir(path.join(project.root, "wiki", "concepts"))).sort(),
      ["概念乙.md", "概念甲.md"].sort());

    await rm(path.join(project.root, "sources", "b.md"));
    await compileProject(project);
    assert.deepEqual(await readdir(path.join(project.root, "wiki", "concepts")), ["概念甲.md"]);
    const state = JSON.parse(await readFile(path.join(project.root, ".llmwiki", "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state.sources), ["a.md"]);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("子目录同名文件使用不同状态键和来源路径", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "left/same.md", "左概念");
    await writeSource(project.root, "right/same.md", "右概念");
    await compileProject(project);
    const state = JSON.parse(await readFile(path.join(project.root, ".llmwiki", "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state.sources).sort(), ["left/same.md", "right/same.md"]);
    const left = await readFile(path.join(project.root, "wiki", "concepts", "左概念.md"), "utf8");
    assert.match(left, /left\/same.md/);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("空资料、解析失败、空概念和提取失败均保留成功快照", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "原概念");
    await compileProject(project);
    const conceptPath = path.join(project.root, "wiki", "concepts", "原概念.md");
    const statePath = path.join(project.root, ".llmwiki", "state.json");
    const oldConcept = await readFile(conceptPath, "utf8");
    const oldState = await readFile(statePath, "utf8");

    await rm(path.join(project.root, "sources", "a.md"));
    assert.deepEqual(await readAllDocuments(project.sourcesDirectory), []);
    await assert.rejects(compileProject(project), /没有可编译的 source/);
    await writeFile(path.join(project.root, "sources", "bad.md"), "无 Frontmatter", "utf8");
    await assert.rejects(readAllDocuments(project.sourcesDirectory), /bad.md 解析失败/);
    await rm(path.join(project.root, "sources", "bad.md"));
    await writeSource(project.root, "a.md", "原概念");
    await assert.rejects(compileProject(project, { async generateText() {
      return JSON.stringify({ concepts: [] });
    } }), /未提取到概念/);
    await assert.rejects(compileProject(project, createProvider("extract-error")), /模型提取失败/);
    assert.equal(await readFile(conceptPath, "utf8"), oldConcept);
    assert.equal(await readFile(statePath, "utf8"), oldState);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("合并失败和写入目标异常时保留旧 Wiki、索引和状态", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "共享概念");
    await compileProject(project);
    const wikiRoot = path.join(project.root, "wiki");
    const conceptPath = path.join(wikiRoot, "concepts", "共享概念.md");
    const indexPath = path.join(wikiRoot, "index.md");
    const statePath = path.join(project.root, ".llmwiki", "state.json");
    const before = await Promise.all([conceptPath, indexPath, statePath].map((file) => readFile(file, "utf8")));
    await writeSource(project.root, "b.md", "共享概念");
    await assert.rejects(compileProject(project, createProvider("merge-error")), /模型合并失败/);

    // 把状态文件临时改为目录，验证发布前的目标校验不会覆盖任何旧产物。
    const heldState = `${statePath}.held`;
    await rename(statePath, heldState);
    await mkdir(statePath);
    await assert.rejects(compileProject(project), /目标路径类型不符合预期/);
    await rm(statePath, { recursive: true });
    await rename(heldState, statePath);
    assert.deepEqual(await Promise.all([conceptPath, indexPath, statePath].map((file) => readFile(file, "utf8"))), before);
    await compileProject(project);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("索引或状态安装失败时逆序恢复全部旧产物", async () => {
  for (const failedKind of ["index", "state"]) {
    const root = await mkdtemp(path.join(process.cwd(), ".publish-test-"));
    try {
      const artifacts: StagedArtifact[] = [];
      for (const [name, kind] of [["concepts", "directory"], ["index", "file"], ["state", "file"]] as const) {
        const targetPath = path.join(root, name);
        const stagedPath = path.join(root, `.${name}.tmp`);
        if (kind === "directory") {
          await mkdir(targetPath); await mkdir(stagedPath);
          await writeFile(path.join(targetPath, "old.md"), "old");
          await writeFile(path.join(stagedPath, "new.md"), "new");
        } else {
          await writeFile(targetPath, `old-${name}`);
          await writeFile(stagedPath, `new-${name}`);
        }
        artifacts.push({ targetPath, stagedPath, kind });
      }
      await assert.rejects(publishSnapshot(artifacts, async (from, to) => {
        if (String(from).endsWith(`.${failedKind}.tmp`)) throw new Error(`${failedKind} 安装失败`);
        await rename(from, to);
      }), /安装失败/);
      assert.deepEqual(await readdir(path.join(root, "concepts")), ["old.md"]);
      assert.equal(await readFile(path.join(root, "index"), "utf8"), "old-index");
      assert.equal(await readFile(path.join(root, "state"), "utf8"), "old-state");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
