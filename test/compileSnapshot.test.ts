import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileDocuments, CompileDocumentsOptions } from "../src/compile/compileDocuments.ts";
import { readCompileState } from "../src/compile/comparisonCompileState.ts";
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
async function compileProject(
  project: Awaited<ReturnType<typeof createProject>>,
  provider: LlmProvider | (() => LlmProvider) = createProvider(),
  overrides: Partial<CompileDocumentsOptions> = {},
) {
  const documents = await readAllDocuments(project.sourcesDirectory);
  return compileDocuments(documents, provider, {
    concurrency: 2, modelId: "test-model",
    sourcesDirectory: project.sourcesDirectory,
    outputDirectory: project.outputDirectory,
    stateFilePath: project.stateFilePath,
    ...overrides,
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
    } }, { force: true }), /未提取到概念/);
    await assert.rejects(compileProject(project, createProvider("extract-error"), { force: true }), /模型提取失败/);
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

/** 记录提取与跨来源合并调用次数，验证缓存确实节省模型请求。 */
function createCountingProvider() {
  const calls = { extract: 0, merge: 0 };
  const provider: LlmProvider = {
    async generateText(messages) {
      const prompt = messages[1].content;
      if (prompt.includes("请综合下面")) {
        calls.merge += 1;
        return JSON.stringify({ concept: {
          name: "共享概念", aliases: [], summary: "综合摘要", tags: [], confidence: 1,
          content: "综合内容", keyPoints: [], relatedConcepts: [],
        } });
      }
      calls.extract += 1;
      const name = prompt.match(/"title":\s*"([^\"]+)"/)?.[1] ?? "未知概念";
      const summary = prompt.includes("修改后的内容") ? "修改后的摘要" : name;
      return JSON.stringify({ concepts: [{
        name, aliases: [], summary, tags: [], confidence: 1,
        content: summary, keyPoints: [], relatedConcepts: [], evidence: [],
      }] });
    },
  };
  return { provider, calls };
}

test("无变化不请求模型且不改写文件，局部变化只重新提取和合并受影响的概念", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "共享概念");
    await writeSource(project.root, "b.md", "共享概念");
    await writeSource(project.root, "c.md", "独有概念");
    const first = createCountingProvider();
    await compileProject(project, first.provider);
    assert.deepEqual(first.calls, { extract: 3, merge: 1 });
    const statePath = path.join(project.root, ".llmwiki", "state.json");
    const indexPath = path.join(project.root, "wiki", "index.md");
    const conceptPath = path.join(project.root, "wiki", "concepts", "共享概念.md");
    const before = await Promise.all([statePath, indexPath, conceptPath].map((file) => readFile(file, "utf8")));
    const skipped = await compileProject(project, () => { throw new Error("不应创建 Provider"); });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reusedSources, 3);
    assert.equal(skipped.reusedGroups, 2);
    assert.deepEqual(await Promise.all([statePath, indexPath, conceptPath].map((file) => readFile(file, "utf8"))), before);

    await writeSource(project.root, "a.md", "共享概念", "修改后的内容");
    const partial = createCountingProvider();
    const result = await compileProject(project, partial.provider);
    assert.deepEqual(partial.calls, { extract: 1, merge: 1 });
    assert.equal(result.reusedSources, 2);
    assert.equal(result.reusedGroups, 1);
    assert.equal(result.rebuiltGroups, 1);
    assert.deepEqual((await readdir(path.join(project.root, "wiki", "concepts"))).sort(),
      ["共享概念.md", "独有概念.md"].sort());

    await rm(path.join(project.root, "sources", "b.md"));
    const deletion = await compileProject(project, () => { throw new Error("删除不需要模型"); });
    assert.equal(deletion.deleted, 1);
    assert.equal(deletion.reusedSources, 2);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(Object.keys(state.sources), ["a.md", "c.md"]);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("产物缺失可由缓存恢复；模型切换需强制刷新；损坏状态完整重建", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "概念甲");
    await compileProject(project);
    const statePath = path.join(project.root, ".llmwiki", "state.json");
    const indexPath = path.join(project.root, "wiki", "index.md");
    await rm(indexPath);
    const repaired = await compileProject(project, () => { throw new Error("恢复不需要模型"); });
    assert.equal(repaired.skipped, false);
    assert.match(await readFile(indexPath, "utf8"), /概念甲/);
    const conceptPath = path.join(project.root, "wiki", "concepts", "概念甲.md");
    await rm(conceptPath);
    await compileProject(project, () => { throw new Error("概念文件恢复不需要模型"); });
    assert.match(await readFile(conceptPath, "utf8"), /概念甲/);

    const changedModelNoop = await compileProject(project,
      () => { throw new Error("无变化不需要模型"); }, { modelId: "other-model" });
    assert.equal(changedModelNoop.skipped, true);
    await rm(indexPath);
    await compileProject(project, () => { throw new Error("恢复不需要模型"); },
      { modelId: "other-model" });
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).modelId, "test-model");
    await writeSource(project.root, "a.md", "概念甲", "修改后的内容");
    const oldState = await readFile(statePath, "utf8");
    await assert.rejects(compileProject(project, createProvider(), { modelId: "other-model" }), /--force/);
    assert.equal(await readFile(statePath, "utf8"), oldState);

    const forced = createCountingProvider();
    const forcedResult = await compileProject(project, forced.provider,
      { modelId: "other-model", force: true });
    assert.equal(forced.calls.extract, 1);
    assert.equal(forcedResult.changed, 1);
    const unchangedForce = createCountingProvider();
    await compileProject(project, unchangedForce.provider, { modelId: "other-model", force: true });
    assert.equal(unchangedForce.calls.extract, 1);
    await writeFile(statePath, "{broken", "utf8");
    const rebuilt = createCountingProvider();
    await compileProject(project, rebuilt.provider, { modelId: "other-model" });
    assert.equal(rebuilt.calls.extract, 1);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).version, 2);
    const damaged = JSON.parse(await readFile(statePath, "utf8"));
    damaged.sources["a.md"].candidates[0].concept.evidence = "broken";
    await writeFile(statePath, JSON.stringify(damaged), "utf8");
    const recovered = createCountingProvider();
    await compileProject(project, recovered.provider, { modelId: "other-model" });
    assert.equal(recovered.calls.extract, 1);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("状态缺少复用必需字段时视为无效缓存", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "a.md", "概念甲");
    await compileProject(project);
    const statePath = path.join(project.root, ".llmwiki", "state.json");
    const original = JSON.parse(await readFile(statePath, "utf8"));
    const groupKey = Object.keys(original.groups)[0];

    const missingOutputFiles = structuredClone(original);
    delete missingOutputFiles.outputFiles;
    await writeFile(statePath, JSON.stringify(missingOutputFiles), "utf8");
    assert.equal(await readCompileState(statePath), null);

    const missingCandidates = structuredClone(original);
    delete missingCandidates.sources["a.md"].candidates;
    await writeFile(statePath, JSON.stringify(missingCandidates), "utf8");
    assert.equal(await readCompileState(statePath), null);

    const missingConceptField = structuredClone(original);
    delete missingConceptField.groups[groupKey].concept.relatedConcepts;
    await writeFile(statePath, JSON.stringify(missingConceptField), "utf8");
    assert.equal(await readCompileState(statePath), null);

    // 签名内容不再在读取阶段重算；这里只验证它仍是字符串。
    const changedSignature = structuredClone(original);
    changedSignature.groups[groupKey].signature = "different";
    await writeFile(statePath, JSON.stringify(changedSignature), "utf8");
    assert.notEqual(await readCompileState(statePath), null);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("source 重命名按删除旧路径和新增新路径处理，其他同名文件继续复用", async () => {
  const project = await createProject();
  try {
    await writeSource(project.root, "left/same.md", "左概念");
    await writeSource(project.root, "right/same.md", "右概念");
    await compileProject(project);
    await mkdir(path.join(project.root, "sources", "renamed"), { recursive: true });
    await rename(path.join(project.root, "sources", "left", "same.md"),
      path.join(project.root, "sources", "renamed", "new.md"));
    const counting = createCountingProvider();
    const result = await compileProject(project, counting.provider);
    assert.equal(result.added, 1);
    assert.equal(result.deleted, 1);
    assert.equal(result.reusedSources, 1);
    assert.equal(counting.calls.extract, 1);
    const state = JSON.parse(await readFile(path.join(project.root, ".llmwiki", "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state.sources).sort(), ["renamed/new.md", "right/same.md"]);
    assert.match(await readFile(path.join(project.root, "wiki", "concepts", "左概念.md"), "utf8"),
      /renamed\/new.md/);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
