import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { compareSourceDocuments, CompileState, sourceInputHash } from "../src/compile/comparisonCompileState.ts";
import { runSync, SyncDependencies } from "../src/commands/sync.ts";
import { SourceTypeEnum } from "../src/tools/shared.ts";
import { SourceDocument } from "../src/types/document.ts";

/** 为同步流程构造无需实际落盘的 source。 */
function document(name: string, content = name): SourceDocument {
  return {
    filePath: path.resolve("sources", name),
    frontmatter: { title: name, source: "local", sourceType: SourceTypeEnum.LocalMarkdown },
    content,
  };
}

/** 只提供比较阶段会读取的成功状态字段。 */
function stateFor(documents: SourceDocument[]): CompileState {
  return {
    version: 2, modelId: "test-model", baseURL: "http://localhost", groups: {}, outputFiles: [],
    sources: Object.fromEntries(documents.map((item) => [
      path.relative(path.resolve("sources"), item.filePath).split(path.sep).join("/"),
      { hash: sourceInputHash(item), candidates: [] },
    ])),
  };
}

/** 固定阶段结果，集中验证 sync 的调用顺序和停止条件。 */
function dependenciesFor(documents: SourceDocument[], state: CompileState | null) {
  const calls: string[] = [];
  const dependencies: SyncDependencies = {
    readDocuments: async () => { calls.push("read"); return documents; },
    readState: async () => { calls.push("state"); return state; },
    compile: async (_documents, options) => {
      calls.push(`compile:${options.concurrency}:${options.force}`);
      return {
        candidateCount: 1, conceptCount: 1, added: 0, changed: 0, deleted: 0,
        reusedSources: 0, reusedGroups: 0, rebuiltGroups: 1, skipped: false,
      };
    },
    vector: async () => { calls.push("vector"); return { fileCount: 1, embeddingCount: 1 }; },
  };
  return { calls, dependencies };
}

test("首次同步依次检查、编译、向量化，并返回新增数量", async () => {
  const { calls, dependencies } = dependenciesFor([document("a.md")], null);
  const result = await runSync(dependencies);
  assert.deepEqual(calls, ["read", "state", "compile:1:false", "vector"]);
  assert.deepEqual(result && {
    added: result.sources.added, changed: result.sources.changed,
    deleted: result.sources.deleted, unchanged: result.sources.unchanged,
  }, { added: 1, changed: 0, deleted: 0, unchanged: 0 });
  assert.deepEqual(result?.vector, { fileCount: 1, embeddingCount: 1 });
});

test("无变化仍执行向量化；局部修改和删除按上轮状态统计", async () => {
  const first = [document("a.md"), document("b.md"), document("c.md")];
  const saved = stateFor(first);
  const unchanged = dependenciesFor(first, saved);
  const sameResult = await runSync(unchanged.dependencies);
  assert.deepEqual(unchanged.calls, ["read", "state", "compile:1:false", "vector"]);
  assert.equal(sameResult?.sources.unchanged, 3);

  const partial = dependenciesFor([document("a.md", "修改内容"), document("c.md")], saved);
  const partialResult = await runSync(partial.dependencies);
  assert.deepEqual(partial.calls, ["read", "state", "compile:1:false", "vector"]);
  assert.deepEqual(partialResult && {
    added: partialResult.sources.added, changed: partialResult.sources.changed,
    deleted: partialResult.sources.deleted, unchanged: partialResult.sources.unchanged,
  }, { added: 0, changed: 1, deleted: 1, unchanged: 1 });
});

test("资料为空时停止，保留已有 Wiki 和索引", async () => {
  const { calls, dependencies } = dependenciesFor([], null);
  assert.equal(await runSync(dependencies), null);
  assert.deepEqual(calls, ["read"]);
});

test("编译失败后不运行向量阶段；向量失败则向调用方抛错", async () => {
  const failedCompile = dependenciesFor([document("a.md")], null);
  failedCompile.dependencies.compile = async () => { throw new Error("编译失败"); };
  await assert.rejects(runSync(failedCompile.dependencies), /编译失败/);
  assert.deepEqual(failedCompile.calls, ["read", "state"]);

  const failedVector = dependenciesFor([document("a.md")], null);
  failedVector.dependencies.vector = async () => { throw new Error("向量化失败"); };
  await assert.rejects(runSync(failedVector.dependencies), /向量化失败/);
  assert.deepEqual(failedVector.calls, ["read", "state", "compile:1:false"]);
});

test("资料比较对重复路径报错，防止检查与编译口径分叉", () => {
  assert.throws(() => compareSourceDocuments([document("a.md"), document("a.md")], null), /重复的 source 路径/);
});
