import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";
import { parseSourceFile } from "./parseSourceFile";
import { SourceDocument } from "@/types/document";
import { loadCompileState } from "./comparisonCompileState";
import { extractFilePath } from "@/utils/name";

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

/**
 * 解析 `sources` 目录中的全部 Markdown 文档。
 *
 * 全量 Wiki 编译依赖所有 source 的概念，因此这里不会根据历史哈希跳过未变化文件。
 *
 * @returns 成功解析的全部 source 文档。
 */
export async function readAllDocuments(): Promise<SourceDocument[]> {
  const sourceFilesList: SourceDocument[] = [];

  const sourceFiles = await readSourceFiles('sources');

  if (sourceFiles.length === 0) {
    console.log(chalk.red("sources 目录中没有找到 Markdown 文件。"));
    return []
  }

  console.log(chalk.blueBright(`识别到的可编译文件：\n${sourceFiles.join('\n')}`))
  console.log(chalk.greenBright(`共找到 ${sourceFiles.length} 个 Markdown 文件：`));

  for (const sourceFile of sourceFiles) {
    const document = await parseSourceFile(sourceFile);
    const displayPath = extractFilePath(sourceFile)
    if (!document) {
      console.log(chalk.redBright(`❌ ${displayPath} 文件处理失败`));
      continue
    }

    try {
      loadCompileState(document)
    } catch {
      console.log(chalk.yellow(`⚠️ ${displayPath} 文件已编译，跳过编译！`));
      continue
    }

    sourceFilesList.push(document);
  }

  return sourceFilesList;
}
