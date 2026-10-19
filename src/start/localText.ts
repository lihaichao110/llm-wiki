import { SourceTypeEnum, titleFromFilename } from "@/tools/shared";
import { processNamedSource, type ImportResult } from "@/start/processNamedSource";
import { readFile } from "node:fs/promises";

/**
 * 导入本地 UTF-8 TXT 文件，生成编译可用的 Markdown source。
 *
 * @param filePath 原文件的真实绝对路径。
 * @returns 写入或因同名跳过的结果。
 * @throws 文件读取或 Markdown 写入失败时抛出错误。
 */
export async function importLocalText(filePath: string): Promise<ImportResult> {
  const title = titleFromFilename(filePath);
  if (!title) {
    throw new Error(`无法从文件名生成标题：${filePath}`);
  }

  return processNamedSource(title, () => readFile(filePath, "utf8"), {
    title,
    source: filePath,
    sourceType: SourceTypeEnum.LocalText,
  });
}

/**
 * 导入本地 UTF-8 Markdown 文件，将文件原文作为正文写入 source。
 *
 * @param filePath 原文件的真实绝对路径。
 * @returns 写入或因同名跳过的结果。
 * @throws 文件读取或 Markdown 写入失败时抛出错误。
 */
export async function importLocalMarkdown(filePath: string): Promise<ImportResult> {
  const title = titleFromFilename(filePath);
  if (!title) {
    throw new Error(`无法从文件名生成标题：${filePath}`);
  }

  return processNamedSource(title, () => readFile(filePath, "utf8"), {
    title,
    source: filePath,
    sourceType: SourceTypeEnum.LocalMarkdown,
  });
}
