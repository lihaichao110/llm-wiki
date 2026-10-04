import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * 递归查找目录中的 Markdown 文件。
 *
 * @param directory 当前需要扫描的目录。
 * @returns 找到的 Markdown 文件绝对路径。
 */
export async function collectMarkdownFiles(directory: string) {
  const entries = await readdir(directory, {
    withFileTypes: true
  })

  // 保存当前目录以及子目录中找到的 Markdown 文件。
  const markdownFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      const childFiles = await collectMarkdownFiles(entryPath);
      markdownFiles.push(...childFiles);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles;
}

/**
 * 读取项目 sources 目录中的全部 Markdown 文件。
 *
 * @param sourcesDirectory sources 目录，默认使用当前项目下的 sources。
 * @returns 按文件路径排序后的 Markdown 文件列表。
 */
export async function readSourceFiles(
  sourcesDirectory: string,
): Promise<string[]> {
  try {
    const sourceFiles = await collectMarkdownFiles(resolve(process.cwd(), sourcesDirectory));

    // 固定排序可以保证每次编译时的文件处理顺序一致。
    return sourceFiles.sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}