import { isHttpUrl, isPdfUrl } from "@/utils/is";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

/** start 命令当前支持的输入类型。 */
export type StartInputKind = "web" | "onlinePdf" | "localPdf" | "localText" | "localMarkdown" | "localSpreadsheet" | "localDirectory";

/** 可通过文件扩展名识别并直接导入的本地文件类型。 */
export type LocalFileInputKind = Exclude<StartInputKind, "web" | "onlinePdf" | "localDirectory">;

/** 已识别的输入；可导入项同时提供任务显示名，目录由扫描结果提供逐项显示名。 */
export type ResolvedStartInput =
  | { kind: "localDirectory"; value: string }
  | { kind: Exclude<StartInputKind, "localDirectory">; value: string; displayName: string };

/** 本地扩展名与处理器类型的映射，扩展名统一使用小写。 */
export const LOCAL_INPUT_KINDS: Readonly<Record<string, LocalFileInputKind | undefined>> = {
  ".pdf": "localPdf",
  ".txt": "localText",
  ".md": "localMarkdown",
  ".xlsx": "localSpreadsheet",
  ".xls": "localSpreadsheet",
};

/**
 * 识别 URL、本地文件或目录，并为 start 命令选择处理器。
 *
 * @param input 命令行传入的 URL 或文件路径。
 * @returns 输入类型、可直接交给处理器的地址，以及可导入项的显示名。
 * @throws URL 无效、路径不存在或单文件格式不支持时抛出错误。
 */
export async function resolveStartInput(input: string): Promise<ResolvedStartInput> {
  if (isHttpUrl(input)) {
    try {
      new URL(input);
    } catch {
      throw new Error(`无效的 HTTP(S) 地址：${input}`);
    }

    return {
      kind: isPdfUrl(input) ? "onlinePdf" : "web",
      value: input,
      displayName: input,
    };
  }

  if (input.includes("://")) {
    throw new Error("仅支持 HTTP(S) 地址或本地文件路径");
  }

  /** 保留用户路径的扩展名，允许指向不同文件名的符号链接。 */
  const absolutePath = path.resolve(input);
  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`本地文件不存在：${absolutePath}`);
    }
    throw error;
  }

  if (fileStats.isDirectory()) {
    return { kind: "localDirectory", value: await realpath(absolutePath) };
  }
  if (!fileStats.isFile()) {
    throw new Error(`请输入普通文件或目录：${absolutePath}`);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const kind = LOCAL_INPUT_KINDS[extension];
  if (!kind) {
    throw new Error(`不支持的本地文件类型：${extension || "无扩展名"}`);
  }

  const realPath = await realpath(absolutePath);
  return { kind, value: realPath, displayName: path.basename(realPath) };
}
