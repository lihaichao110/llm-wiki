import { saveCompileState } from '@/compile/comparisonCompileState';
import { extractAllConcepts } from '@/compile/extractConcept';
import {
  mergeConceptCandidateGroups,
  mergeConceptCandidates,
} from '@/compile/mergeConceptCandidates';
import { readAllDocuments } from '@/compile/readSources';
import { replaceWikiConceptFiles } from '@/compile/replaceWikiConceptFiles';
import { createProviderFromEnv } from '@/providers/createProviderFromEnv';
import { CompileOptions } from '@/types/compile';
import { ConceptCandidate } from '@/types/concept';
import { extractFilePath } from '@/utils/name';
import chalk from 'chalk';
import { InvalidArgumentError, program } from 'commander';
import { Listr } from 'listr2';
import ora from 'ora';

/**
 * 将命令行输入解析为合法的并行编译数量。
 *
 * @param value 用户传入的并行数量。
 * @returns 大于等于 1 的安全整数。
 * @throws 输入不是正整数时抛出参数错误。
 */
function parseConcurrency(value: string): number {
  const concurrency = Number(value);

  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new InvalidArgumentError("并行编译数量必须是大于等于 1 的整数");
  }

  return concurrency;
}

program.command('compile')
  .option(
    "-c, --concurrency <count>",
    "同时编译的 source 文件数量",
    parseConcurrency,
    1,
  )
  .description('将 sources 中的 Markdown 编译为结构化 Wiki')
  .action(async (option: CompileOptions) => {
    const spinner = ora({
      color: 'cyan',
      text: chalk.green("🚀 开始编译 sources..."),
    }).start();

    // 获取可编译列表
    const canCompileFile = await readAllDocuments();
    if (canCompileFile.length === 0) {
      spinner.warn(chalk.yellow("没有可编译的 source，保留现有 Wiki。"));
      return;
    }

    /** 提取和跨来源综合共用同一个模型配置。 */
    const provider = createProviderFromEnv();

    // Listr2 在提取阶段独占终端动态区域，避免与 Ora 的单行刷新互相覆盖。
    spinner.stop();

    /** 同一轮任务共用提取时间，避免并发完成顺序影响元数据。 */
    const extractedAt = new Date().toISOString();
    /** 按 source 输入顺序保存结果，保证后续合并顺序稳定。 */
    const candidateGroups: ConceptCandidate[][] = new Array(canCompileFile.length);
    /** 收集全部失败，等待其他 source 处理完成后再统一终止编译。 */
    const extractionErrors: Error[] = [];

    const extractionTasks = new Listr(
      canCompileFile.map((document, documentIndex) => {
        const sourceFileName = extractFilePath(document.filePath);

        return {
          title: `${sourceFileName}  等待中`,
          task: async (_context: unknown, task): Promise<void> => {
            task.title = `${sourceFileName}  正在提取...`;

            try {
              const documentCandidates = await extractAllConcepts(
                [document],
                provider,
                {
                  // 全局并发由 Listr2 控制，单个任务只负责一篇 source。
                  concurrency: 1,
                  modelId: process.env.LLM_MODEL ?? "unknown",
                  extractedAt,
                },
              );

              candidateGroups[documentIndex] = documentCandidates;
              task.title = `${sourceFileName}  提取完成，共 ${documentCandidates.length} 个概念`;
              saveCompileState(document)
            } catch (error) {
              const cause = error instanceof Error ? error : new Error(String(error));
              const extractionError = new Error(
                `${sourceFileName} 提取失败：${cause.message}`,
                { cause },
              );

              task.title = `${sourceFileName}  提取失败`;
              extractionErrors.push(extractionError);
              throw extractionError;
            }
          },
        };
      }),
      {
        collectErrors: true,
        concurrent: option.concurrency,
        // 单个 source 失败后仍继续运行其他任务，最后再统一报错。
        exitOnError: false,
      },
    );

    await extractionTasks.run();

    if (extractionErrors.length > 0) {
      throw new AggregateError(
        extractionErrors,
        `有 ${extractionErrors.length} 个 source 文件提取失败，已取消后续 Wiki 写入。`,
      );
    }

    const candidates = candidateGroups.flat();
    console.log(chalk.green(`共提取到 ${candidates.length} 个概念候选。`));

    // 合并重复概念
    spinner.start(chalk.green("正在合并重复概念..."));
    const groups = mergeConceptCandidates(candidates);
    const concepts = await mergeConceptCandidateGroups(groups, provider);
    console.log(chalk.green(`去重合并后：${concepts.length} 个概念。`));

    // 写入目录
    spinner.text = chalk.green("正在写入 Wiki 文件...");
    await replaceWikiConceptFiles(concepts);
    spinner.succeed(chalk.green("\n✅ 编译完成"));
  });
