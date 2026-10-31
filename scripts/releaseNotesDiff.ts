import { execFileSync } from "node:child_process";

/** 单次模型请求中的 diff 字符上限；超出时继续拆分，不丢弃内容。 */
const MAX_DIFF_CHARS = 10_000;
/** 不应成为用户可见更新说明依据的生成或历史文件。 */
const EXCLUDED_PATHS = new Set(["pnpm-lock.yaml", "CHANGELOG.md"]);
/** 只接受发布工作流使用的语义版本 tag，避免任意 Git 修订进入命令参数。 */
const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface DiffChunk {
  /** 包含文件名与完整 diff 片段的模型输入。 */
  text: string;
  /** 该片段实际涉及的文件，供模型输出校验。 */
  files: string[];
}

export interface ReleaseDiff {
  tag: string;
  previousTag: string | null;
  chunks: DiffChunk[];
  changedFiles: string[];
}

/**
 * 在指定仓库运行 Git，统一限制输出大小；超过限制时显式失败，不截断补丁。
 * @param args Git 参数，不经 shell 插值。
 * @param cwd 仓库目录。
 * @param input 可选标准输入。
 * @returns Git 的 UTF-8 输出。
 */
function git(args: string[], cwd: string, input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * 将单个文件的大补丁按行切成连续片段；超长行也会按字符继续切分。
 * @param diff 完整文件补丁。
 * @param path 文件路径，用于每片重申上下文。
 * @returns 保留全部补丁字符的片段。
 */
function splitFileDiff(diff: string, path: string): DiffChunk[] {
  const prefix = `文件：${path}\n以下是完整补丁的连续片段，片段边界可能位于一行中：\n`;
  const budget = MAX_DIFF_CHARS - prefix.length;
  const chunks: DiffChunk[] = [];
  let offset = 0;
  while (offset < diff.length) {
    const limit = Math.min(offset + budget, diff.length);
    let end = limit;
    if (limit < diff.length) {
      const lastNewline = diff.lastIndexOf("\n", limit);
      if (lastNewline > offset + budget / 2) end = lastNewline + 1;
    }
    chunks.push({ text: prefix + diff.slice(offset, end), files: [path] });
    offset = end;
  }
  return chunks;
}

/**
 * 比较 package.json 除版本号外的内容，避免版本提交被描述成产品变更。
 * @param base 前一个 tag 或空树。
 * @param tag 当前发布 tag。
 * @param cwd 仓库目录。
 * @returns 仅 version 字段变化时为 true。
 */
function isVersionOnlyPackageChange(base: string, tag: string, cwd: string): boolean {
  try {
    const before = JSON.parse(git(["show", `${base}:package.json`], cwd)) as Record<string, unknown>;
    const after = JSON.parse(git(["show", `${tag}:package.json`], cwd)) as Record<string, unknown>;
    if (before.version === after.version) return false;
    delete before.version;
    delete after.version;
    return JSON.stringify(before) === JSON.stringify(after);
  } catch {
    return false;
  }
}

/**
 * 读取目标 tag 与其最近祖先版本 tag 之间的所有文本补丁。
 * @param tag 要发布的语义版本 tag。
 * @param cwd 仓库目录。
 * @returns 分片后的完整差异与版本边界。
 * @throws tag 不存在或 Git 无法完整读取补丁时抛错。
 */
export function readReleaseDiff(tag: string, cwd: string): ReleaseDiff {
  if (!VERSION_TAG.test(tag)) throw new Error(`无效的发布 tag：${tag}`);
  git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], cwd);

  let previousTag: string | null = null;
  try {
    previousTag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${tag}^{commit}^`], cwd).trim();
  } catch {
    // 首个版本 tag 没有前一个版本，使用 Git 空树作为比较起点。
  }
  const base = previousTag ?? git(["hash-object", "-t", "tree", "--stdin"], cwd, "").trim();
  const changedFiles = git(["diff", "--no-renames", "--name-only", "-z", base, tag, "--"], cwd)
    .split("\0")
    .filter((path) => path !== "" && !EXCLUDED_PATHS.has(path))
    .filter((path) => path !== "package.json" || !isVersionOnlyPackageChange(base, tag, cwd));

  const chunks: DiffChunk[] = [];
  for (const path of changedFiles) {
    const diff = git(["diff", "--no-renames", "--no-ext-diff", "--no-color", "--unified=3", base, tag, "--", path], cwd);
    if (diff === "") throw new Error(`无法读取 ${path} 的完整差异`);
    chunks.push(...splitFileDiff(diff, path));
  }
  return { tag, previousTag, chunks, changedFiles };
}
