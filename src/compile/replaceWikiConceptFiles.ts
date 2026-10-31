import { writeConceptFiles } from "@/compile/writeConceptFile";
import { FRONTMATTER_PATTERN } from "@/tools/shared";
import { WikiConcept } from "@/types/concept";
import { isRecord } from "@/utils/is";
import { normalizeConceptName } from "@/utils/name";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { createIndexFiles } from "./createIndexFile";
import { STATE_JSON } from "./comparisonCompileState";
import { publishSnapshot, StagedArtifact } from "./publishSnapshot";

/** Wiki 概念目录替换选项。 */
export interface ReplaceWikiConceptFilesOptions {
  /** 相对于当前工作目录的目标目录。 */
  outputDirectory?: string;
  /** 编译命令传入完整成功状态；回调可读取实际写出的文件名和创建时间。 */
  stateContent?: string | ((outputFiles: string[], concepts: readonly WikiConcept[]) => string);
  /** 状态文件路径，默认 `STATE_JSON`。 */
  stateFilePath?: string;
}

/**
 * 判断文件系统路径是否存在。
 *
 * @param filePath 待检查的文件或目录路径。
 * @returns 路径存在时返回 true，否则返回 false。
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * 校验并解析受编译器管理的输出目录。
 *
 * @param outputDirectory 相对于当前工作目录的输出目录。
 * @returns 校验后的绝对路径。
 */
function resolveOutputDirectory(outputDirectory: string): string {
  const normalizedDirectory = outputDirectory.trim();
  if (!normalizedDirectory) {
    throw new Error("Wiki 概念输出目录不能为空");
  }
  if (path.isAbsolute(normalizedDirectory) || path.win32.isAbsolute(normalizedDirectory)) {
    throw new Error("Wiki 概念输出目录必须是相对路径");
  }

  const segments = normalizedDirectory.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) {
    throw new Error("Wiki 概念输出目录不能包含 `..` 路径段");
  }

  const cwd = path.resolve(process.cwd());
  const targetDirectory = path.resolve(cwd, normalizedDirectory);
  const relativeDirectory = path.relative(cwd, targetDirectory);
  if (
    relativeDirectory === ""
    || relativeDirectory === ".."
    || relativeDirectory.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeDirectory)
  ) {
    throw new Error("Wiki 概念输出目录必须位于当前工作目录内部");
  }

  return targetDirectory;
}

/**
 * 从现有 Wiki 页面读取规范化名称到首次创建时间的映射。
 *
 * 无效 Markdown 或 Frontmatter 会被忽略，使对应页面按新页面处理。
 *
 * @param outputDirectory 现有 Wiki 概念目录的绝对路径。
 * @returns 规范化概念名称与首次创建时间的映射。
 */
async function readExistingCreatedAt(
  outputDirectory: string,
): Promise<Map<string, string>> {
  const createdAtByName = new Map<string, string>();
  if (!await pathExists(outputDirectory)) {
    return createdAtByName;
  }

  const entries = await readdir(outputDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }

    try {
      const content = await readFile(path.join(outputDirectory, entry.name), "utf8");
      const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
      if (!frontmatterMatch) {
        continue;
      }

      const frontmatter = parseYaml(frontmatterMatch[1]);
      if (
        !isRecord(frontmatter)
        || typeof frontmatter.title !== "string"
        || typeof frontmatter.createdAt !== "string"
      ) {
        continue;
      }

      const normalizedName = normalizeConceptName(frontmatter.title);
      if (normalizedName && !createdAtByName.has(normalizedName)) {
        createdAtByName.set(normalizedName, frontmatter.createdAt);
      }
    } catch {
      // 单个旧页面损坏不应阻止全量重建；该页面会获得新的 createdAt。
    }
  }

  return createdAtByName;
}

/**
 * 用完整的新快照替换 Wiki 概念目录。
 *
 * 概念页、索引和可选状态会先写入临时路径，再依次发布。
 * 发布异常时按相反顺序恢复旧产物；状态始终最后提交。
 *
 * @param concepts 已完成跨来源综合的概念。
 * @param options 输出目录及可选的完整成功状态。
 */
export async function replaceWikiConceptFiles(
  concepts: WikiConcept[],
  options: ReplaceWikiConceptFilesOptions = {},
): Promise<void> {
  const outputDirectory = resolveOutputDirectory(
    options.outputDirectory ?? "wiki/concepts",
  );
  const parentDirectory = path.dirname(outputDirectory);
  const outputName = path.basename(outputDirectory);
  /** 索引始终属于本次概念输出目录，避免测试或自定义目录覆盖默认 Wiki。 */
  const indexFilePath = path.join(parentDirectory, "index.md");
  const indexStagingPath = path.join(parentDirectory, `.index.tmp-${randomUUID()}.md`);
  /** 只有编译命令提供状态内容时才会触及状态文件。 */
  const stateFilePath = options.stateContent === undefined ? undefined : path.resolve(
    process.cwd(), options.stateFilePath ?? STATE_JSON,
  );
  if (stateFilePath) {
    const relativeStatePath = path.relative(process.cwd(), stateFilePath);
    if (
      !relativeStatePath || relativeStatePath === ".."
      || relativeStatePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeStatePath)
    ) {
      throw new Error("编译状态文件必须位于当前工作目录内部");
    }
    await mkdir(path.dirname(stateFilePath), { recursive: true });
    const realStateParent = await realpath(path.dirname(stateFilePath));
    const realCwd = await realpath(process.cwd());
    const relativeRealStateParent = path.relative(realCwd, realStateParent);
    if (relativeRealStateParent === ".."
      || relativeRealStateParent.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeRealStateParent)) {
      throw new Error("编译状态目录不能通过符号链接超出当前工作目录");
    }
  }
  const stateStagingPath = stateFilePath
    ? path.join(path.dirname(stateFilePath), `.state.tmp-${randomUUID()}.json`)
    : undefined;

  await mkdir(parentDirectory, { recursive: true });
  /** 阻止父目录通过符号链接逃逸到当前工作目录之外。 */
  const [realCwd, realParentDirectory] = await Promise.all([
    realpath(process.cwd()),
    realpath(parentDirectory),
  ]);
  const relativeRealParent = path.relative(realCwd, realParentDirectory);
  if (
    relativeRealParent === ".."
    || relativeRealParent.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeRealParent)
  ) {
    throw new Error("Wiki 概念输出目录不能通过符号链接超出当前工作目录");
  }

  const createdAtByName = await readExistingCreatedAt(outputDirectory);
  const stagingDirectory = await mkdtemp(
    path.join(parentDirectory, `.${outputName}.tmp-`),
  );

  const conceptsWithHistory = concepts.map((concept) => ({
    ...concept,
    createdAt: createdAtByName.get(normalizeConceptName(concept.name))
      ?? concept.createdAt,
  }));
  const relativeStagingDirectory = path.relative(process.cwd(), stagingDirectory);
  try {
    await writeConceptFiles(conceptsWithHistory, relativeStagingDirectory);
    await createIndexFiles(conceptsWithHistory, indexStagingPath);
    /** 状态记录实际输出文件和保留的创建时间，并且最后才替换旧状态。 */
    if (stateStagingPath !== undefined && options.stateContent !== undefined) {
      const stateContent = typeof options.stateContent === "function"
        ? options.stateContent(await readdir(stagingDirectory), conceptsWithHistory)
        : options.stateContent;
      await writeFile(stateStagingPath, stateContent, "utf8");
    }

    const artifacts: StagedArtifact[] = [
      { targetPath: outputDirectory, stagedPath: stagingDirectory, kind: "directory" },
      { targetPath: indexFilePath, stagedPath: indexStagingPath, kind: "file" },
    ];
    if (stateFilePath && stateStagingPath) {
      artifacts.push({ targetPath: stateFilePath, stagedPath: stateStagingPath, kind: "file" });
    }
    await publishSnapshot(artifacts);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(indexStagingPath, { force: true });
    if (stateStagingPath) await rm(stateStagingPath, { force: true });
  }
}
