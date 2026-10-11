import chalk from "chalk";
import { mkdir, readFile, readdir } from "fs/promises";
import path, { join } from "path";
import { splitMarkdown } from "./splitMarkdown";
import { createEmbedding } from "./createEmbedding";
import { Listr } from "listr2";
import { saveEmbeddings } from "./saveEmbeddings";
import type { EmbeddingInfo } from "@/types/embedding";

/**
 * 初始化项目根目录中的向量数据存储目录。
 *
 * @returns 目录创建完成后结束；失败时将错误交由 CLI 统一处理。
 * @throws 文件系统无法创建目录时抛出原始错误。
 */
export default async function initializeVectorStorage() {
  /** 向量数据的约定存储位置，基于执行 CLI 时的项目目录解析。 */
  const storageDirectory = path.resolve(process.cwd(), '.llmwiki');
  /** Wiki 概念 Markdown 文件的来源目录。 */
  const conceptsDirectory = path.resolve('wiki/concepts');

  await mkdir(storageDirectory, { recursive: true });
  console.log(chalk.green(`向量数据存储目录已就绪：${storageDirectory}`));

  const entries = await readdir(conceptsDirectory, { withFileTypes: true });
  const markdownFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
  );

  if (markdownFiles.length === 0) {
    console.log(chalk.yellow("目录【wiki/concepts】中没有可向量化的 Markdown 文件。"));
    return;
  }

  console.log(chalk.green(`目录【wiki/concepts】扫描完成，可向量化文件数量：${markdownFiles.length}`));

  /** 按文件索引暂存成功结果，最终写盘顺序与扫描顺序一致。 */
  const embeddingsByFile: (EmbeddingInfo[] | undefined)[] = new Array(markdownFiles.length);
  /** 记录文件失败原因；任务队列会继续处理其他 Markdown 文件。 */
  const processingErrors: Error[] = [];
  const embeddingTasks = new Listr(
    markdownFiles.map((file, fileIndex) => ({
      title: `${file.name}  等待处理`,
      task: async (_context: unknown, task): Promise<void> => {
        task.title = `${file.name}  正在处理...`;

        try {
          const markdown = await readFile(join(conceptsDirectory, file.name), "utf8");
          // 保留后期扩展为多分块向量化的切分入口。
          const chunks = splitMarkdown(markdown);
          const embeddingInfoList = await createEmbedding(chunks, file.name);
          embeddingsByFile[fileIndex] = embeddingInfoList;
          task.title = `${file.name}  处理完成，生成 ${embeddingInfoList.length} 个向量`;
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          const processingError = new Error(`${file.name} 向量化失败：${cause.message}`, { cause });

          task.title = `${file.name}  处理失败`;
          processingErrors.push(processingError);
          throw processingError;
        }
      },
    })),
    {
      // 保持现有逐文件顺序，且单文件失败后继续处理剩余文件。
      concurrent: false,
      exitOnError: false,
    },
  );

  await embeddingTasks.run();

  /** 跳过失败文件，只汇总本次成功完成的向量记录。 */
  const successfulEmbeddings = embeddingsByFile.flatMap((embeddings) => embeddings ?? []);
  const successfulFileCount = embeddingsByFile.filter((embeddings) => embeddings !== undefined).length;

  if (successfulFileCount > 0) {
    const outputPath = await saveEmbeddings(successfulEmbeddings, storageDirectory);

    console.log(chalk.green(`向量保存成功：${successfulEmbeddings.length} 条，文件：${outputPath}`));
  }

  if (processingErrors.length > 0) {
    // 在成功保存提示之后逐项列出失败文件，便于用户同时确认两类结果。
    console.log(chalk.yellow("以下文件处理失败："));
    for (const error of processingErrors) {
      console.log(chalk.red(`- ${error.message}`));
    }

    throw new AggregateError(
      processingErrors,
      `有 ${processingErrors.length} 个 Markdown 文件向量化失败：${processingErrors
        .map((error) => error.message)
        .join("；")}`,
    );
  }
}
