import type { HeaderSource } from "@/tools/shared";
import {
  markdownFileExists,
  normalizeMarkdownFileName,
  writeMarkdownFile,
} from "@/utils/writeMarkdownFile";

/** 所有 start 输入共用的输出目录。 */
const SOURCE_DIRECTORY = "sources";
/** 同一输出名的任务链，避免本轮导入内重复读取或转换正文。 */
const pendingByFileName = new Map<string, Promise<void>>();

/** 单项导入的结果，用于 Listr2 展示和最终统计。 */
export type ImportResult = "written" | "skipped";

/**
 * 按目标文件名串行执行检查与写入；不同文件名仍可并发处理。
 *
 * @param fileName 输出文件名或标题。
 * @param createContent 仅在目标尚不存在时生成 Markdown 正文。
 * @param frontmatter 写入 source 的元数据。
 * @returns 写入或因同名而跳过的结果。
 * @throws 正文生成或文件系统操作失败时透传异常，并释放同名任务锁。
 */
export async function processNamedSource(
  fileName: string,
  createContent: () => Promise<string> | string,
  frontmatter: HeaderSource,
): Promise<ImportResult> {
  const normalizedFileName = normalizeMarkdownFileName(fileName);
  const previous = pendingByFileName.get(normalizedFileName) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingByFileName.set(normalizedFileName, current);

  await previous;
  try {
    if (await markdownFileExists(fileName, SOURCE_DIRECTORY)) {
      return "skipped";
    }

    const content = await createContent();
    return await writeMarkdownFile(fileName, content, {
      directory: SOURCE_DIRECTORY,
      frontmatter,
      onConflict: "skip",
    });
  } finally {
    release();
    if (pendingByFileName.get(normalizedFileName) === current) {
      pendingByFileName.delete(normalizedFileName);
    }
  }
}
