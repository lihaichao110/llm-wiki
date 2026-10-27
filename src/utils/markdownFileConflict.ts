import { FRONTMATTER_PATTERN } from "@/tools/shared";
import { isErrorCode } from "@/utils/markdownFilePath";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

/**
 * 将 Frontmatter 中的单数或复数来源转换为用于比较和哈希的稳定标识。
 *
 * 多个来源会去除空值和重复项并保留首次出现顺序；单个来源继续使用原字符串，
 * 以兼容既有文件的来源比较和哈希文件名。
 *
 * @param frontmatter - 待解析来源字段的 Frontmatter 数据。
 * @returns 规范化来源标识；没有有效来源时返回 undefined。
 */
export const createSourceIdentity = (frontmatter: unknown): string | undefined => {
  if (typeof frontmatter !== "object" || frontmatter === null) {
    return undefined;
  }

  /** 未清理的来源值，单数 source 优先于复数 sources。 */
  const rawSources: unknown[] = [];
  if ("source" in frontmatter) {
    rawSources.push(frontmatter.source);
  }
  if ("sources" in frontmatter && Array.isArray(frontmatter.sources)) {
    rawSources.push(...frontmatter.sources);
  }

  /** 去除无效值和重复项后的来源列表，顺序与首次出现顺序一致。 */
  const sources = Array.from(new Set(
    rawSources
      .filter((source): source is string => typeof source === "string")
      .map((source) => source.trim())
      .filter(Boolean),
  ));

  if (sources.length === 0) {
    return undefined;
  }

  return sources.length === 1 ? sources[0] : JSON.stringify(sources);
};

/**
 * 从已有 Markdown 文件中读取 Frontmatter 的规范化来源标识。
 *
 * @param filePath - 待检查的 Markdown 文件路径。
 * @returns 文件存在状态，以及能够安全解析时的规范化来源标识。
 * @throws 读取文件时遇到非 `ENOENT` 错误时抛出原异常。
 */
export const readExistingSourceIdentity = async (
  filePath: string,
): Promise<{ exists: boolean; sourceIdentity?: string }> => {
  /** 已有 Markdown 文件的原始文本。 */
  let fileContent: string;
  try {
    fileContent = await readFile(filePath, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return { exists: false };
    }
    throw error;
  }

  /** 文件顶部 Frontmatter 的正则匹配结果。 */
  const frontmatterMatch = fileContent.match(FRONTMATTER_PATTERN);
  if (!frontmatterMatch) {
    return { exists: true };
  }

  try {
    /** 解析后的 YAML Frontmatter 数据。 */
    const frontmatter = parse(frontmatterMatch[1]);
    /** 已有文件使用单数或复数来源生成的统一标识。 */
    const sourceIdentity = createSourceIdentity(frontmatter);
    if (sourceIdentity) {
      return { exists: true, sourceIdentity };
    }
  } catch {
    // 旧文件的 YAML 无效时保留原文件，并让调用方写入带哈希的新文件。
  }

  return { exists: true };
};

/**
 * 为标题重名但来源不同的文件选择不会覆盖其他来源的路径。
 *
 * @param directory - 已通过安全检查的输出目录。
 * @param normalizedFileName - 已规范化的 Markdown 文件名。
 * @param sourceIdentity - 当前内容的规范化来源标识。
 * @returns 未占用或属于相同来源的哈希文件路径。
 */
export const resolveHashedFilePath = async (
  directory: string,
  normalizedFileName: string,
  sourceIdentity: string,
): Promise<string> => {
  /** Markdown 文件的扩展名。 */
  const extension = path.extname(normalizedFileName);
  /** 不包含扩展名的规范化文件名。 */
  const baseName = path.basename(normalizedFileName, extension);
  /** 根据来源生成的稳定哈希，用于区分同名但不同来源的文件。 */
  const sourceHash = createHash("sha256").update(sourceIdentity).digest("hex");

  for (let hashLength = 8; hashLength <= sourceHash.length; hashLength += 4) {
    /** 使用递增长度哈希后缀生成的候选路径。 */
    const candidatePath = path.join(
      directory,
      `${baseName}-${sourceHash.slice(0, hashLength)}${extension}`,
    );
    /** 候选文件的存在状态和来源信息。 */
    const candidate = await readExistingSourceIdentity(candidatePath);
    if (!candidate.exists || candidate.sourceIdentity === sourceIdentity) {
      return candidatePath;
    }
  }

  // 完整哈希仍被未知文件占用时继续编号，始终避免覆盖其他内容。
  for (let suffix = 1; ; suffix += 1) {
    /** 完整哈希被占用后追加序号的候选路径。 */
    const candidatePath = path.join(
      directory,
      `${baseName}-${sourceHash}-${suffix}${extension}`,
    );
    /** 带序号候选文件的存在状态和来源信息。 */
    const candidate = await readExistingSourceIdentity(candidatePath);
    if (!candidate.exists || candidate.sourceIdentity === sourceIdentity) {
      return candidatePath;
    }
  }
};

