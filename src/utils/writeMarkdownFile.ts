import type { HeaderSource } from "@/tools/shared";
import { createSourceIdentity, readExistingSourceIdentity, resolveHashedFilePath } from "@/utils/markdownFileConflict";
import { isErrorCode, normalizeMarkdownFileName, resolveTargetDirectory } from "@/utils/markdownFilePath";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";

export { normalizeMarkdownFileName } from "@/utils/markdownFilePath";

/** 写入 Markdown 文件时使用的目录与 Frontmatter 配置。 */
export interface MarkdownFileConfig {
  /** 相对于当前工作目录的输出目录。 */
  directory: string;
  /** 写入文件顶部的 YAML Frontmatter 数据。 */
  frontmatter: HeaderSource;
  /** start 导入时按最终文件名跳过，其他调用方沿用来源冲突处理。 */
  onConflict?: "skip";
}

/**
 * 在读取或转换正文前判断目标 Markdown 文件是否已被占用。
 *
 * @param fileName 原始标题或文件名。
 * @param directory 相对于当前工作目录的输出目录。
 * @returns 规范化后的目标文件是否存在，包括符号链接。
 */
export const markdownFileExists = async (
  fileName: string,
  directory: string,
): Promise<boolean> => {
  const targetDirectory = await resolveTargetDirectory(directory);
  const targetFilePath = path.join(targetDirectory, normalizeMarkdownFileName(fileName));
  try {
    await lstat(targetFilePath);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
};

/**
 * 在当前命令执行目录的指定子目录内创建或更新 Markdown 文件。
 * 默认按 Frontmatter 来源覆盖或追加哈希；start 的 skip 模式只独占创建空缺文件。
 * 来源可以使用单数 source 或复数 sources 表示。
 *
 * @param fileName - 目标 Markdown 文件名或用于生成文件名的标题。
 * @param content - 不包含 Frontmatter 的 Markdown 正文。
 * @param config - 输出目录及 Frontmatter 配置。
 * @returns 实际写入或因同名跳过的结果。
 * @throws 配置无效、路径越界或文件系统操作失败时抛出异常。
 */
export const writeMarkdownFile = async (
  fileName: string,
  content: string,
  config: MarkdownFileConfig,
): Promise<"written" | "skipped"> => {
  /** 当前内容由单数或复数来源生成的统一标识。 */
  const sourceIdentity = createSourceIdentity(config.frontmatter);
  if (!sourceIdentity) {
    throw new Error(
      "Markdown Frontmatter 的 source 或 sources 必须包含至少一个非空字符串",
    );
  }

  /** 经过路径边界和符号链接校验的真实输出目录。 */
  const targetDirectory = await resolveTargetDirectory(config.directory);
  /** 清理非法字符后的跨平台 Markdown 文件名。 */
  const normalizedFileName = normalizeMarkdownFileName(fileName);
  /** 未发生来源冲突时优先使用的文件路径。 */
  const defaultFilePath = path.join(targetDirectory, normalizedFileName);
  if (config.onConflict === "skip") {
    /** 独占创建保证检查后出现同名文件时也不会覆盖。 */
    const serializedFrontmatter = stringify(config.frontmatter).trimEnd();
    const markdownContent = `---\n${serializedFrontmatter}\n---\n\n${content}`;
    try {
      await writeFile(defaultFilePath, markdownContent, { encoding: "utf8", flag: "wx" });
      return "written";
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        return "skipped";
      }
      throw error;
    }
  }
  /** 默认文件路径的占用状态及已有来源标识。 */
  const existingFile = await readExistingSourceIdentity(defaultFilePath);
  /** 最终写入路径；来源冲突时改用带来源哈希的文件名。 */
  const targetFilePath =
    !existingFile.exists || existingFile.sourceIdentity === sourceIdentity
      ? defaultFilePath
      : await resolveHashedFilePath(
        targetDirectory,
        normalizedFileName,
        sourceIdentity,
      );

  /** 序列化并移除结尾空白后的 YAML Frontmatter。 */
  const serializedFrontmatter = stringify(config.frontmatter).trimEnd();
  /** 包含 YAML Frontmatter 和正文的完整 Markdown 内容。 */
  const markdownContent = `---\n${serializedFrontmatter}\n---\n\n${content}`;

  await writeFile(targetFilePath, markdownContent, "utf8");
  return "written";
};
