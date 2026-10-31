import { compileDocuments, CompileResult } from "@/compile/compileDocuments";
import { extractAllConcepts } from "@/compile/extractConcept";
import { readAllDocuments } from "@/compile/readSources";
import { createProviderFromEnv } from "@/providers/createProviderFromEnv";
import { CompileOptions, ExtractAllConceptsOptions } from "@/types/compile";
import { ConceptCandidate } from "@/types/concept";
import { SourceDocument } from "@/types/document";
import { LlmProvider } from "@/types/provider";
import chalk from "chalk";
import { InvalidArgumentError, program } from "commander";
import { Listr } from "listr2";
import path from "node:path";
import ora from "ora";

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

/**
 * 使用 Listr 展示每篇资料的提取状态，同时按输入顺序返回候选。
 *
 * @param documents 本轮完整的资料列表。
 * @param provider 所有任务共用的模型。
 * @param options 并发数、模型与来源路径配置。
 * @returns 按资料顺序排列的全部概念候选。
 * @throws 任一资料提取失败时汇总错误，阻止后续合并和发布。
 */
async function extractCandidatesWithListr(
  documents: readonly SourceDocument[],
  provider: LlmProvider,
  options: ExtractAllConceptsOptions,
): Promise<ConceptCandidate[]> {
  /** 同一轮任务共用提取时间，避免完成顺序影响输出元数据。 */
  const extractedAt = new Date().toISOString();
  /** 并行任务按输入位置保存结果，合并顺序不受完成时间影响。 */
  const candidateGroups: ConceptCandidate[][] = new Array(documents.length);
  /** Listr 会继续执行其他任务；本数组保留全部提取失败原因。 */
  const extractionErrors: Error[] = [];
  /** 空结果仍允许参与整轮编译，但需要把跳过的资料明确告知用户。 */
  const emptySourceFiles: string[] = [];
  const sourcesRoot = path.resolve(process.cwd(), options.sourcesDirectory ?? "sources");
  const extractionTasks = new Listr(
    documents.map((document, documentIndex) => {
      const sourceFileName = path.relative(sourcesRoot, document.filePath).split(path.sep).join("/");
      return {
        title: `${sourceFileName}  等待中`,
        task: async (_context: unknown, task): Promise<void> => {
          task.title = `${sourceFileName}  正在提取...`;
          try {
            const candidates = await extractAllConcepts([document], provider, {
              ...options,
              // 由 Listr 控制全局并发；单项任务仅提取当前资料。
              concurrency: 1,
              extractedAt,
            });
            candidateGroups[documentIndex] = candidates;
            if (candidates.length === 0) {
              emptySourceFiles.push(sourceFileName);
              task.title = `${sourceFileName}  未提取到概念，请核对资料内容`;
            } else {
              task.title = `${sourceFileName}  提取完成，共 ${candidates.length} 个概念`;
            }
          } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));
            const extractionError = new Error(`${sourceFileName} 提取失败：${cause.message}`, { cause });
            task.title = `${sourceFileName}  提取失败`;
            extractionErrors.push(extractionError);
            throw extractionError;
          }
        },
      };
    }),
    {
      collectErrors: true,
      concurrent: options.concurrency,
      // 一篇资料失败后仍处理其余资料，再统一取消本轮发布。
      exitOnError: false,
    },
  );

  try {
    await extractionTasks.run();
  } catch (error) {
    if (extractionErrors.length === 0) throw error;
  }
  if (extractionErrors.length > 0) {
    throw new AggregateError(
      extractionErrors,
      `有 ${extractionErrors.length} 个 source 文件提取失败，已取消后续 Wiki 写入。`,
    );
  }
  if (emptySourceFiles.length > 0) {
    console.warn(chalk.yellow(`以下 source 未生成 Wiki 页面：${emptySourceFiles.join("、")}`));
  }
  return candidateGroups.flat();
}

/**
 * 为已有的完整资料列表运行编译，并展示提取、合并与发布进度。
 * @param documents 已解析的当前全部 source。
 * @param option 并发数与强制刷新选项。
 * @returns 本轮编译和缓存复用统计。
 * @throws 编译失败时保留旧 Wiki 和状态并继续抛错。
 */
export async function runCompile(
  documents: readonly SourceDocument[],
  option: CompileOptions,
): Promise<CompileResult> {
  const spinner = ora({ color: "cyan", text: chalk.green("🚀 开始编译 sources...") }).start();
  try {
    // Listr 独占动态终端区域，避免与 Ora 的单行刷新互相覆盖。
    spinner.stop();
    const result = await compileDocuments(documents, createProviderFromEnv, {
      concurrency: option.concurrency,
      modelId: process.env.LLM_MODEL ?? "",
      baseURL: process.env.LLM_BASE_URL ?? "",
      force: option.force,
      extractCandidates: extractCandidatesWithListr,
      onPhaseStart: (phase) => {
        spinner.start(chalk.green(phase === "merge"
          ? "正在合并重复概念..."
          : "正在写入 Wiki 文件..."));
      },
    });
    spinner.succeed(chalk.green(result.skipped
      ? `资料未变化，已跳过编译：复用 ${result.reusedSources} 篇 source、${result.reusedGroups} 个概念组。`
      : `编译完成：新增 ${result.added}、修改 ${result.changed}、删除 ${result.deleted}、复用 ${result.reusedSources} 篇 source；复用 ${result.reusedGroups}、重新生成 ${result.rebuiltGroups} 个概念组；共 ${result.candidateCount} 个候选、${result.conceptCount} 个概念。`));
    return result;
  } catch (error) {
    spinner.fail(chalk.red("编译失败，已保留上一轮成功的 Wiki 和状态。"));
    throw error;
  }
}

program.command("compile")
  .option("-c, --concurrency <count>", "同时编译的 source 文件数量", parseConcurrency, 1)
  .option("--force", "忽略缓存，重新编译全部 source")
  .description("将 sources 中的 Markdown 编译为结构化 Wiki")
  .action(async (option: CompileOptions) => {
    const documents = await readAllDocuments();
    if (documents.length === 0) {
      console.warn(chalk.yellow("没有可编译的 source，保留现有 Wiki。"));
      return;
    }
    await runCompile(documents, option);
  });
