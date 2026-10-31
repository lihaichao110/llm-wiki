import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LlmMessage } from "../src/types/llm";
import type { LlmProvider } from "../src/types/provider";
import { generateReleaseNotes, parseReleaseNotes } from "../scripts/releaseNotes";
import { readReleaseDiff, type ReleaseDiff } from "../scripts/releaseNotesDiff";

/** 为版本边界测试创建独立 Git 历史，不依赖主仓库的 tag。 */
function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "release-notes-"));
  execFileSync("git", ["init", "-q", cwd]);
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd });
  execFileSync("git", ["config", "user.email", "release@example.com"], { cwd });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "package.json"), '{"name":"demo","version":"1.0.13"}\n');
  writeFileSync(join(cwd, "src", "index.ts"), "export const value = 1;\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "初始版本"], { cwd });
  execFileSync("git", ["tag", "v1.0.13"], { cwd });
  return cwd;
}

/** 仅返回预置 JSON 的模型，用于验证调用次数、输入来源和失败处理。 */
class FakeProvider implements LlmProvider {
  readonly calls: LlmMessage[][] = [];

  constructor(private readonly responses: string[]) {}

  async generateText(messages: readonly LlmMessage[]): Promise<string> {
    this.calls.push([...messages]);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("模拟模型缺少响应");
    return response;
  }
}

test("只读取两个 tag 之间的代码，忽略版本号与提交标题", () => {
  const cwd = createRepository();
  try {
    writeFileSync(join(cwd, "src", "index.ts"), "export const value = 2;\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "feat: 这是不应进入模型的提交标题"], { cwd });
    writeFileSync(join(cwd, "package.json"), '{"name":"demo","version":"1.0.14"}\n');
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "1.0.14"], { cwd });
    execFileSync("git", ["tag", "v1.0.14"], { cwd });

    const diff = readReleaseDiff("v1.0.14", cwd);
    assert.equal(diff.previousTag, "v1.0.13");
    assert.deepEqual(diff.changedFiles, ["src/index.ts"]);
    assert.match(diff.chunks[0].text, /\+export const value = 2/);
    assert.doesNotMatch(diff.chunks[0].text, /这是不应进入模型的提交标题|"version":"1.0.14"/);
    assert.throws(() => readReleaseDiff("v1.0.15", cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("首个 tag 以空树为起点读取全部初始代码", () => {
  const cwd = createRepository();
  try {
    const diff = readReleaseDiff("v1.0.13", cwd);
    assert.equal(diff.previousTag, null);
    assert.deepEqual(diff.changedFiles, ["package.json", "src/index.ts"]);
    assert.match(diff.chunks.map((chunk) => chunk.text).join("\n"), /export const value = 1/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("较大的文件差异会分片并保留末尾内容", () => {
  const cwd = createRepository();
  try {
    writeFileSync(join(cwd, "src", "index.ts"), `export const content = "${"文".repeat(16_000)}末尾标记";\n`);
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "feat: 大文件"], { cwd });
    execFileSync("git", ["tag", "v1.0.14"], { cwd });
    const diff = readReleaseDiff("v1.0.14", cwd);
    assert.ok(diff.chunks.length > 1);
    assert.ok(diff.chunks.every((chunk) => chunk.text.length <= 10_000));
    assert.match(diff.chunks.at(-1)!.text, /末尾标记/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("根据补丁片段提取并合并中文 Release 正文", async () => {
  const diff: ReleaseDiff = {
    tag: "v1.0.14",
    previousTag: "v1.0.13",
    changedFiles: ["src/sync.ts", "src/vector.ts"],
    chunks: [
      { text: "文件：src/sync.ts\n+export function sync() {}", files: ["src/sync.ts"] },
      { text: "文件：src/vector.ts\n+throw new Error('向量失败')", files: ["src/vector.ts"] },
    ],
  };
  const provider = new FakeProvider([
    JSON.stringify({ items: [{ category: "新增", text: "新增同步命令", files: ["src/sync.ts"] }] }),
    JSON.stringify({ items: [{ category: "修复", text: "向量失败时保留旧索引", files: ["src/vector.ts"] }] }),
    JSON.stringify({ items: [
      { category: "新增", text: "新增同步命令", files: ["src/sync.ts"] },
      { category: "修复", text: "向量失败时保留旧索引", files: ["src/vector.ts"] },
    ] }),
    JSON.stringify({ summary: "本次更新加入同步命令，并提高向量索引的可靠性。" }),
  ]);

  const result = await generateReleaseNotes(diff, provider);
  assert.match(result, /^## v1\.0\.14\n\n本次更新加入同步命令，并提高向量索引的可靠性。\n\n### ✨ New Features\n\n- 新增同步命令/);
  assert.match(result, /### 🐛 Bug Fixes\n\n- 向量失败时保留旧索引/);
  assert.match(result, /\*\*Full Changelog\*\*: \[https:\/\/github\.com\/lihaichao110\/llm-wiki\/compare\/v1\.0\.13\.\.\.v1\.0\.14\]\(https:\/\/github\.com\/lihaichao110\/llm-wiki\/compare\/v1\.0\.13\.\.\.v1\.0\.14\)\n$/);
  assert.doesNotMatch(result, /Breaking Changes|Improvements|Documentation|Others/);
  assert.equal(provider.calls.length, 4);
  assert.match(provider.calls[0][1].content, /\+export function sync/);
  assert.match(provider.calls[0][0].content, /命令行工具/);
  assert.match(provider.calls[3][1].content, /新增同步命令/);
});

test("候选说明超过单次输入上限时分层汇总且不丢失批次", async () => {
  const file = "src/feature.ts";
  const candidates = Array.from({ length: 60 }, (_, index) => ({
    category: "改进", text: `改进项 ${index}：${"内容".repeat(90)}`, files: [file],
  }));
  const diff: ReleaseDiff = {
    tag: "v1.0.14", previousTag: "v1.0.13", changedFiles: [file],
    chunks: [{ text: "+第一片", files: [file] }, { text: "+第二片", files: [file] }],
  };
  const provider = new FakeProvider([
    JSON.stringify({ items: candidates }),
    '{"items":[]}',
    JSON.stringify({ items: [{ category: "改进", text: "汇总前半部分", files: [file] }] }),
    JSON.stringify({ items: [{ category: "改进", text: "汇总后半部分", files: [file] }] }),
    JSON.stringify({ items: [
      { category: "改进", text: "汇总前半部分", files: [file] },
      { category: "改进", text: "汇总后半部分", files: [file] },
    ] }),
    JSON.stringify({ summary: "本次更新优化了现有功能。" }),
  ]);
  const result = await generateReleaseNotes(diff, provider);
  assert.match(result, /汇总前半部分/);
  assert.match(result, /汇总后半部分/);
  const batchedInputs = provider.calls.slice(2, 4).map((call) => call[1].content).join("\n");
  assert.match(batchedInputs, /改进项 0/);
  assert.match(batchedInputs, /改进项 59/);
});

test("破坏性变更优先展示并提示升级风险，其他分类依次排列", async () => {
  const file = "src/index.ts";
  const diff: ReleaseDiff = {
    tag: "v2.0.0", previousTag: "v1.9.0", changedFiles: [file],
    chunks: [{ text: "+新的命令行为", files: [file] }],
  };
  const items = [
    { category: "其他", text: "更新发布流程", files: [file] },
    { category: "文档", text: "补充升级说明", files: [file] },
    { category: "改进", text: "缩短启动等待时间", files: [file] },
    { category: "修复", text: "修复导入失败后的状态显示", files: [file] },
    { category: "新增", text: "支持同步现有资料", files: [file] },
    { category: "破坏性变更", text: "旧版配置格式需要迁移", files: [file] },
  ];
  const result = await generateReleaseNotes(diff, new FakeProvider([
    JSON.stringify({ items }),
    JSON.stringify({ summary: "本次更新支持同步资料，并调整旧版配置格式。" }),
  ]));
  const headings = [...result.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, [
    "⚠️ Breaking Changes", "✨ New Features", "🐛 Bug Fixes",
    "⚡ Improvements", "📝 Documentation", "🧪 Others",
  ]);
  assert.match(result, /### ⚠️ Breaking Changes\n\n> ⚠️ 升级前请留意以下兼容性变化。\n\n- 旧版配置格式需要迁移/);
});

test("首个版本保留简洁概述并省略无旧标签的比较链接", async () => {
  const file = "src/index.ts";
  const diff: ReleaseDiff = {
    tag: "v1.0.0", previousTag: null, changedFiles: [file],
    chunks: [{ text: "+初始功能", files: [file] }],
  };
  const result = await generateReleaseNotes(diff, new FakeProvider([
    JSON.stringify({ items: [{ category: "新增", text: "支持导入网页资料", files: [file] }] }),
    JSON.stringify({ summary: "首个版本支持导入网页资料。" }),
  ]));
  assert.equal(result, "## v1.0.0\n\n首个版本支持导入网页资料。\n\n### ✨ New Features\n\n- 支持导入网页资料\n");
});

test("模型结果无效或缺少文件证据时阻止发布", async () => {
  assert.throws(() => parseReleaseNotes("不是 JSON", ["src/sync.ts"]), /有效 JSON/);
  assert.throws(
    () => parseReleaseNotes(JSON.stringify({ items: [{ category: "新增", text: "新增同步", files: ["其他文件.ts"] }] }), ["src/sync.ts"]),
    /文件证据/,
  );
  assert.throws(
    () => parseReleaseNotes(JSON.stringify({ items: [{ category: "新增", text: "Add sync command", files: ["src/sync.ts"] }] }), ["src/sync.ts"]),
    /说明文字无效/,
  );
  const diff: ReleaseDiff = {
    tag: "v1.0.14", previousTag: "v1.0.13", changedFiles: ["src/sync.ts"],
    chunks: [{ text: "+同步命令", files: ["src/sync.ts"] }],
  };
  await assert.rejects(generateReleaseNotes(diff, new FakeProvider(['{"items":[]}'])), /没有从代码差异中提取/);
  await assert.rejects(generateReleaseNotes(diff, new FakeProvider([])), /模拟模型缺少响应/);
  await assert.rejects(generateReleaseNotes({ ...diff, chunks: [] }, new FakeProvider([])), /没有可用于生成说明/);
  const validItems = JSON.stringify({ items: [{ category: "新增", text: "支持同步资料", files: ["src/sync.ts"] }] });
  await assert.rejects(generateReleaseNotes(diff, new FakeProvider([validItems, "不是 JSON"])), /概述 JSON/);
  await assert.rejects(generateReleaseNotes(diff, new FakeProvider([validItems, JSON.stringify({ summary: "### 错误概述" })])), /版本概述无效/);
  await assert.rejects(generateReleaseNotes(diff, new FakeProvider([validItems, JSON.stringify({ summary: "支持同步资料。还支持其他功能。" })])), /版本概述无效/);
});
