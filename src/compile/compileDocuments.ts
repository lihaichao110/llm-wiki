import { SourceDocument } from "@/types/document";
import { ExtractAllConceptsOptions } from "@/types/compile";
import { ConceptCandidate } from "@/types/concept";
import { LlmProvider } from "@/types/provider";
import { serializeCompileState } from "./comparisonCompileState";
import { extractAllConcepts } from "./extractConcept";
import { mergeConceptCandidateGroups, mergeConceptCandidates } from "./mergeConceptCandidates";
import { replaceWikiConceptFiles } from "./replaceWikiConceptFiles";

/** 一轮全量编译的输入与输出路径。 */
export interface CompileDocumentsOptions {
  concurrency: number;
  modelId: string;
  sourcesDirectory?: string;
  outputDirectory?: string;
  stateFilePath?: string;
  /** CLI 可接入逐文件任务展示；默认使用内部并发提取器。 */
  extractCandidates?: (
    documents: readonly SourceDocument[],
    provider: LlmProvider,
    options: ExtractAllConceptsOptions,
  ) => Promise<ConceptCandidate[]>;
  /** 通知调用方合并或发布阶段开始，用于更新终端进度。 */
  onPhaseStart?: (phase: "merge" | "publish") => void;
}

/**
 * 对完整的 source 快照提取、合并并发布 Wiki 与成功状态。
 *
 * @param documents 本轮扫描到的全部有效资料；空数组由调用方跳过。
 * @param provider 提取与跨来源合并共用的模型。
 * @param options 并发量、模型标识和测试可指定的路径。
 * @returns 本轮候选与最终概念的数量。
 * @throws 任一模型或发布阶段失败时保留旧快照并抛出异常。
 */
export async function compileDocuments(
  documents: readonly SourceDocument[],
  provider: LlmProvider,
  options: CompileDocumentsOptions,
): Promise<{ candidateCount: number; conceptCount: number }> {
  if (documents.length === 0) {
    throw new Error("没有可编译的 source，保留现有 Wiki");
  }

  /** 先计算完整状态，确保路径错误不会发生在 Wiki 发布之后。 */
  const stateContent = serializeCompileState(
    documents, options.sourcesDirectory ?? "sources",
  );
  const candidates = await (options.extractCandidates ?? extractAllConcepts)(documents, provider, {
    concurrency: options.concurrency,
    modelId: options.modelId,
    sourcesDirectory: options.sourcesDirectory ?? "sources",
  });
  if (candidates.length === 0) {
    throw new Error("所有 source 均未提取到概念，保留现有 Wiki");
  }

  options.onPhaseStart?.("merge");
  const groups = mergeConceptCandidates(candidates);
  const concepts = await mergeConceptCandidateGroups(groups, provider);
  if (concepts.length === 0) {
    throw new Error("概念合并结果为空，保留现有 Wiki");
  }

  options.onPhaseStart?.("publish");
  await replaceWikiConceptFiles(concepts, {
    outputDirectory: options.outputDirectory,
    stateContent,
    stateFilePath: options.stateFilePath,
  });
  return { candidateCount: candidates.length, conceptCount: concepts.length };
}
