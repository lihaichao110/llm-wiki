import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Windows 不允许直接作为文件名使用的设备名称。 */
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 判断未知异常是否为包含指定错误码的 Node.js 系统异常。
 *
 * @param error - 待判断的异常。
 * @param code - 预期的系统错误码，例如 `ENOENT`。
 * @returns 异常是否具有指定错误码。
 */
export const isErrorCode = (error: unknown, code: string): error is NodeJS.ErrnoException =>
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
export const resolveTargetDirectory = async (directory: string): Promise<string> => {
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
export const normalizeMarkdownFileName = (fileName: string): string => {
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

