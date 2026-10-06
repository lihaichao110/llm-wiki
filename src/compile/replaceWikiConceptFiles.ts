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
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { createIndexFiles } from "./createIndexFile";

/** Wiki 概念目录替换选项。 */
export interface ReplaceWikiConceptFilesOptions {
  /** 相对于当前工作目录的目标目录。 */
  outputDirectory?: string;
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
 * 所有文件会先写入同级临时目录；写入成功后再通过目录改名完成交换。
 * 交换失败时会恢复原目录，因此生成阶段的异常不会留下半更新状态。
 *
 * @param concepts 已完成跨来源综合的概念。
 * @param options 输出目录配置。
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
  const backupDirectory = path.join(
    parentDirectory,
    `.${outputName}.backup-${randomUUID()}`,
  );

  const conceptsWithHistory = concepts.map((concept) => ({
    ...concept,
    createdAt: createdAtByName.get(normalizeConceptName(concept.name))
      ?? concept.createdAt,
  }));
  const relativeStagingDirectory = path.relative(process.cwd(), stagingDirectory);
  let originalMoved = false;
  let replacementInstalled = false;

  try {
    await createIndexFiles(concepts)
    await writeConceptFiles(conceptsWithHistory, relativeStagingDirectory);

    if (await pathExists(outputDirectory)) {
      await rename(outputDirectory, backupDirectory);
      originalMoved = true;
    }

    try {
      await rename(stagingDirectory, outputDirectory);
      replacementInstalled = true;
    } catch (error) {
      if (originalMoved) {
        await rename(backupDirectory, outputDirectory);
        originalMoved = false;
      }
      throw error;
    }

    if (originalMoved) {
      await rm(backupDirectory, { recursive: true, force: true });
      originalMoved = false;
    }
  } finally {
    if (!replacementInstalled) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }
}
