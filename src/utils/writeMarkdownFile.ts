import { FRONTMATTER_PATTERN, HeaderSource } from "@/tools/shared";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";

/** 写入 Markdown 文件时使用的目录与 Frontmatter 配置。 */
export interface MarkdownFileConfig {
  /** 相对于当前工作目录的输出目录。 */
  directory: string;
  /** 写入文件顶部的 YAML Frontmatter 数据。 */
  frontmatter: HeaderSource;
}


/** Windows 不允许直接作为文件名使用的设备名称。 */
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 判断未知异常是否为包含指定错误码的 Node.js 系统异常。
 *
 * @param error - 待判断的异常。
 * @param code - 预期的系统错误码，例如 `ENOENT`。
 * @returns 异常是否具有指定错误码。
 */
const isErrorCode = (error: unknown, code: string): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * 判断目标路径是否等于根路径或位于根路径内部。
 *
 * @param rootPath - 用作安全边界的根路径。
 * @param targetPath - 待校验的目标路径。
 * @returns 目标路径是否处于根路径范围内。
 */
const isPathInside = (rootPath: string, targetPath: string): boolean => {
  /** 目标路径相对于安全根路径的位置。 */
  const relativePath = path.relative(rootPath, targetPath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
};

/**
 * 找到目标路径向上的第一个真实存在目录，用于在创建目录前检查符号链接。
 *
 * @param targetPath - 可能尚未创建的目标路径。
 * @returns 第一个已存在祖先目录的真实路径。
 * @throws 无法解析路径或遇到非 `ENOENT` 文件系统错误时抛出原异常。
 */
const findExistingAncestor = async (targetPath: string): Promise<string> => {
  /** 当前正在检查的目标路径或祖先路径。 */
  let currentPath = targetPath;

  while (true) {
    try {
      return await realpath(currentPath);
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) {
        throw error;
      }

      /** 当前检查路径的直接父目录。 */
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      currentPath = parentPath;
    }
  }
};

/**
 * 解析并创建当前工作目录内的安全目标目录。
 *
 * @param directory - 相对于当前工作目录的输出目录。
 * @returns 创建完成且已解析符号链接的真实目录路径。
 * @throws 目录为空、使用绝对路径、越界或通过符号链接逃逸时抛出异常。
 */
const resolveTargetDirectory = async (directory: string): Promise<string> => {
  /** 去除首尾空白后的用户目录配置。 */
  const normalizedDirectory = directory.trim();
  if (!normalizedDirectory) {
    throw new Error("Markdown 写入目录不能为空");
  }
  if (path.isAbsolute(normalizedDirectory) || path.win32.isAbsolute(normalizedDirectory)) {
    throw new Error("Markdown 写入目录必须是相对于当前工作目录的路径");
  }

  /** 按跨平台分隔符拆分的目录片段，用于识别路径穿越。 */
  const directorySegments = normalizedDirectory.replaceAll("\\", "/").split("/");
  if (directorySegments.includes("..")) {
    throw new Error("Markdown 写入目录不能包含 `..` 路径段");
  }

  /** 当前命令执行目录，是所有文件写入的安全边界。 */
  const cwdPath = path.resolve(process.cwd());
  /** 尚未解析符号链接的绝对目标目录。 */
  const targetDirectory = path.resolve(cwdPath, normalizedDirectory);
  if (!isPathInside(cwdPath, targetDirectory)) {
    throw new Error("Markdown 写入目录不能超出当前工作目录");
  }

  /**
   * 当前目录与目标祖先的真实路径，用于在创建目录前阻止符号链接逃逸。
   */
  const [realCwdPath, existingAncestor] = await Promise.all([
    realpath(cwdPath),
    findExistingAncestor(targetDirectory),
  ]);
  if (!isPathInside(realCwdPath, existingAncestor)) {
    throw new Error("Markdown 写入目录不能通过符号链接超出当前工作目录");
  }

  await mkdir(targetDirectory, { recursive: true });
  /** 创建完成后的真实目标目录，用于执行最终安全边界检查。 */
  const realTargetDirectory = await realpath(targetDirectory);
  if (!isPathInside(realCwdPath, realTargetDirectory)) {
    throw new Error("Markdown 写入目录不能通过符号链接超出当前工作目录");
  }

  return realTargetDirectory;
};

/**
 * 将网页标题等任意输入转换成跨平台可用的 Markdown 文件名。
 *
 * @param fileName - 原始文件名或网页标题。
 * @returns 清理完成且带有 `.md` 扩展名的文件名。
 * @throws 文件名清理后为空或仅包含路径标记时抛出异常。
 */
const normalizeMarkdownFileName = (fileName: string): string => {
  /** 移除已有 Markdown 扩展名及其两侧无意义空白后的基础名称。 */
  const nameWithoutExtension = fileName.trim().replace(/\.md$/i, "").trim();
  /** 将内部空白转换为连接符，并移除非法字符、重复连接符和结尾点号。 */
  const sanitizedName = nameWithoutExtension
    .replace(/\s+/g, "-")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();

  if (!sanitizedName || sanitizedName === "." || sanitizedName === "..") {
    throw new Error("Markdown 文件名清理后不能为空");
  }

  /** Windows 保留设备名会追加后缀，以保持文件名跨平台兼容。 */
  const portableName = WINDOWS_RESERVED_NAME_PATTERN.test(sanitizedName)
    ? `${sanitizedName}-file`
    : sanitizedName;

  return `${portableName}.md`;
};

/**
 * 将 Frontmatter 中的单数或复数来源转换为用于比较和哈希的稳定标识。
 *
 * 多个来源会去除空值和重复项并保留首次出现顺序；单个来源继续使用原字符串，
 * 以兼容既有文件的来源比较和哈希文件名。
 *
 * @param frontmatter - 待解析来源字段的 Frontmatter 数据。
 * @returns 规范化来源标识；没有有效来源时返回 undefined。
 */
const createSourceIdentity = (frontmatter: unknown): string | undefined => {
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
const readExistingSourceIdentity = async (
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
const resolveHashedFilePath = async (
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

/**
 * 在当前命令执行目录的指定子目录内创建或更新 Markdown 文件。
 * 同名文件仅在 Frontmatter 的规范化来源标识相同时覆盖，否则使用来源哈希区分。
 * 来源可以使用单数 source 或复数 sources 表示。
 *
 * @param fileName - 目标 Markdown 文件名或用于生成文件名的标题。
 * @param content - 不包含 Frontmatter 的 Markdown 正文。
 * @param config - 输出目录及 Frontmatter 配置。
 * @returns 文件写入完成后返回，无返回值。
 * @throws 配置无效、路径越界或文件系统操作失败时抛出异常。
 */
export const writeMarkdownFile = async (
  fileName: string,
  content: string,
  config: MarkdownFileConfig,
): Promise<void> => {
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
};
