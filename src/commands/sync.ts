import { compareSourceDocuments, readCompileState, SourceComparison } from "@/compile/comparisonCompileState";
import { readAllDocuments } from "@/compile/readSources";
import initializeVectorStorage, { VectorResult } from "@/vector";
import { CompileResult } from "@/compile/compileDocuments";
import chalk from "chalk";
import { program } from "commander";
import { runCompile } from "./compile";

/** 同步各阶段的可替换入口，便于验证失败后不会进入后续阶段。 */
export interface SyncDependencies {
  readDocuments: typeof readAllDocuments;
  readState: typeof readCompileState;
  compile: typeof runCompile;
  vector: typeof initializeVectorStorage;
}

/** 成功同步时各阶段的统计，用于调用方或测试核对结果。 */
export interface SyncResult {
  sources: SourceComparison;
  compile: CompileResult;
  vector: VectorResult;
}

/** CLI 默认使用已有命令和服务函数，不创建第二套编译或向量流程。 */
const DEFAULT_SYNC_DEPENDENCIES: SyncDependencies = {
  readDocuments: readAllDocuments,
  readState: readCompileState,
  compile: runCompile,
  vector: initializeVectorStorage,
};

/**
 * 检查当前资料、编译 Wiki，再完整重建向量索引。
 * @param dependencies 各阶段的实现，默认使用当前 CLI 流程。
 * @returns 成功时的阶段统计；没有资料时返回 null 且保留已有产物。
 * @throws 任一阶段失败时停止后续阶段，产物状态由对应阶段保证。
 */
export async function runSync(
  dependencies: SyncDependencies = DEFAULT_SYNC_DEPENDENCIES,
): Promise<SyncResult | null> {
  console.log(chalk.blueBright("[1/3] 检查 sources 资料..."));
  let sources: SourceComparison;
  let documents: Awaited<ReturnType<typeof readAllDocuments>>;
  try {
    documents = await dependencies.readDocuments();
    if (documents.length === 0) {
      console.warn(chalk.yellow("没有可编译的 source，保留现有 Wiki 和向量索引。"));
      return null;
    }
    sources = compareSourceDocuments(documents, await dependencies.readState());
  } catch (error) {
    console.error(chalk.red("资料检查失败，Wiki 和向量索引均未更新。"));
    throw error;
  }
  console.log(chalk.green(
    `资料检查完成：新增 ${sources.added}、修改 ${sources.changed}、删除 ${sources.deleted}、未变化 ${sources.unchanged}。`,
  ));

  console.log(chalk.blueBright("[2/3] 编译 Wiki..."));
  let compile: CompileResult;
  try {
    compile = await dependencies.compile(documents, { concurrency: 1, force: false });
  } catch (error) {
    console.error(chalk.red("编译失败，Wiki 和向量索引均未更新；修复原因后重新运行 llm-wiki sync。"));
    throw error;
  }

  console.log(chalk.blueBright("[3/3] 更新向量索引..."));
  let vector: VectorResult;
  try {
    vector = await dependencies.vector();
    if (vector.fileCount === 0 || vector.embeddingCount === 0) {
      throw new Error("没有生成可用的向量索引");
    }
  } catch (error) {
    console.error(chalk.red(
      `${compile.skipped ? "Wiki 未改动" : "Wiki 已更新"}，原有向量索引未改动；修复原因后重新运行 llm-wiki sync。`,
    ));
    throw error;
  }
  console.log(chalk.green(`同步完成：${vector.fileCount} 个概念文件，${vector.embeddingCount} 条向量。`));
  return { sources, compile, vector };
}

program.command("sync")
  .description("检查 sources、编译 Wiki 并重建向量索引")
  .action(async () => { await runSync(); });
