import { ExtractAllConceptsOptions } from "@/types/compile";
import { ConceptCandidate, WikiConcept } from "@/types/concept";
import { SourceDocument } from "@/types/document";
import { LlmProvider } from "@/types/provider";
import { normalizeConceptName } from "@/utils/name";
import {
  CachedGroup, CachedSource, CompileState, compareSourceDocuments, groupSignature,
  hasCompleteOutput, readCompileState, sourceKeyFor,
} from "./comparisonCompileState";
import { extractAllConcepts } from "./extractConcept";
import { mergeConceptCandidateGroups, mergeConceptCandidates } from "./mergeConceptCandidates";
import { replaceWikiConceptFiles } from "./replaceWikiConceptFiles";

/** 编译输入及可覆盖的路径与提取器。 */
export interface CompileDocumentsOptions {
  concurrency: number;
  modelId: string;
  baseURL?: string;
  force?: boolean;
  sourcesDirectory?: string;
  outputDirectory?: string;
  stateFilePath?: string;
  extractCandidates?: (
    documents: readonly SourceDocument[], provider: LlmProvider,
    options: ExtractAllConceptsOptions,
  ) => Promise<ConceptCandidate[]>;
  onPhaseStart?: (phase: "merge" | "publish") => void;
}

/** 本轮对 source 和概念组实际执行的工作。 */
export interface CompileResult {
  candidateCount: number;
  conceptCount: number;
  added: number;
  changed: number;
  deleted: number;
  reusedSources: number;
  reusedGroups: number;
  rebuiltGroups: number;
  skipped: boolean;
}

/**
 * 仅提取变化的 source、综合变化的概念组，最后发布完整 Wiki 快照。
 * 模型或发布失败时，旧状态和产物由发布器保留或回滚。
 * @param documents 当前全部有效 source。
 * @param provider 按需创建或直接使用的模型实现。
 * @param options 并发数、模型配置和输出路径。
 * @returns 提取与综合的复用统计。
 * @throws 输入、模型或发布失败时抛错并保留旧状态。
 */
export async function compileDocuments(
  documents: readonly SourceDocument[],
  provider: LlmProvider | (() => LlmProvider),
  options: CompileDocumentsOptions,
): Promise<CompileResult> {
  if (documents.length === 0) throw new Error("没有可编译的 source，保留现有 Wiki");
  const root = options.sourcesDirectory ?? "sources";
  const saved = await readCompileState(options.stateFilePath);
  const previous = options.force ? null : saved;
  const modelId = options.modelId.trim();
  const baseURL = (options.baseURL ?? "").trim().replace(/\/+$/, "");
  /** 检查阶段与编译共用一份比较口径；强制编译仍把已存在资料计为重新处理。 */
  const comparison = compareSourceDocuments(documents, saved, root);
  const { current, added, deleted } = comparison;
  const changed = comparison.changed + (options.force ? comparison.unchanged : 0);
  const reusedSources = options.force ? 0 : comparison.unchanged;
  const sourceChanged = !previous || added + changed + deleted > 0;
  /** source 与产物都未变时直接结束，避免创建 Provider 或改写任何文件。 */
  const outputComplete = previous && !sourceChanged
    && await hasCompleteOutput(previous, options.outputDirectory);
  if (outputComplete) {
    return {
      candidateCount: Object.values(previous.sources).reduce((n, item) => n + item.candidates.length, 0),
      conceptCount: Object.keys(previous.groups).length,
      added, changed, deleted, reusedSources,
      reusedGroups: Object.keys(previous.groups).length, rebuiltGroups: 0, skipped: true,
    };
  }
  /** source 集合或内容变化时禁止混用不同模型的缓存；纯恢复产物仍可使用旧缓存。 */
  if (sourceChanged && previous && (previous.modelId !== modelId || previous.baseURL !== baseURL)) {
    throw new Error("模型或接口配置与上轮缓存不同，请运行 llm-wiki compile --force 全量刷新");
  }
  /** 仅修复缺失产物时保留缓存原有模型配置，避免把旧结果标记成新模型。 */
  const stateModelId = !sourceChanged && previous ? previous.modelId : modelId;
  const stateBaseURL = !sourceChanged && previous ? previous.baseURL : baseURL;

  /** Provider 延迟创建，缓存恢复和无变化运行均不需要 API 配置。 */
  let instance: LlmProvider | undefined;
  const getProvider = (): LlmProvider => {
    instance ??= typeof provider === "function" ? provider() : provider;
    return instance;
  };

  /** 按 source 的相对路径复用候选，只有哈希变化的文件进入提取队列。 */
  const sources: Record<string, CachedSource> = {};
  const toExtract: SourceDocument[] = [];
  for (const [key, item] of current) {
    const cached = previous?.sources[key];
    if (cached?.hash === item.hash) sources[key] = cached;
    else toExtract.push(item.document);
  }
  if (toExtract.length > 0) {
    /** 提取器返回平坦列表，这里按来源分回各文件，空列表也记为成功缓存。 */
    const extracted = await (options.extractCandidates ?? extractAllConcepts)(
      toExtract, getProvider(), { concurrency: options.concurrency, modelId, sourcesDirectory: root },
    );
    const bySource = new Map(toExtract.map((doc) => [sourceKeyFor(doc, root), [] as ConceptCandidate[]]));
    for (const candidate of extracted) {
      const group = bySource.get(candidate.sourceFileName);
      if (!group || candidate.modelId !== modelId) {
        throw new Error(`提取结果的来源或模型不匹配：${candidate.sourceFileName}`);
      }
      group.push(candidate);
    }
    for (const [key, candidates] of bySource) {
      sources[key] = { hash: current.get(key)!.hash, candidates };
    }
  }

  /** 从当前所有 source 重新分组，删除的来源自然不会留在 Wiki 中。 */
  const orderedSources = Object.fromEntries([...current.keys()].map((key) => [key, sources[key]]));
  const candidates = Object.values(orderedSources).flatMap((item) => item.candidates);
  if (candidates.length === 0) throw new Error("所有 source 均未提取到概念，保留现有 Wiki");
  const candidateGroups = mergeConceptCandidates(candidates);
  const groups: Record<string, CachedGroup> = {};
  let reusedGroups = 0;
  let rebuiltGroups = 0;
  /** 候选签名未变就直接复用综合结果，其他组才重新综合。 */
  for (const group of candidateGroups) {
    const signature = groupSignature(group);
    const cached = previous?.groups[group.normalizedName];
    if (cached?.signature === signature) {
      groups[group.normalizedName] = cached;
      reusedGroups += 1;
      continue;
    }
    if (rebuiltGroups === 0) options.onPhaseStart?.("merge");
    const [concept] = await mergeConceptCandidateGroups(
      [group], group.candidates.length > 1 ? getProvider() : undefined,
    );
    groups[group.normalizedName] = { signature, concept };
    rebuiltGroups += 1;
  }
  const concepts = candidateGroups.map((group) => groups[group.normalizedName].concept);

  /** 发布器把实际文件名与保留的 createdAt 一并写进同一份成功状态。 */
  options.onPhaseStart?.("publish");
  await replaceWikiConceptFiles(concepts, {
    outputDirectory: options.outputDirectory,
    stateFilePath: options.stateFilePath,
    stateContent: (outputFiles, published) => {
      const publishedByName = new Map<string, WikiConcept>(
        published.map((concept) => [normalizeConceptName(concept.name), concept]),
      );
      for (const [key, group] of Object.entries(groups)) {
        group.concept = publishedByName.get(key) ?? group.concept;
      }
      const state: CompileState = {
        version: 2, modelId: stateModelId, baseURL: stateBaseURL,
        sources: orderedSources, groups, outputFiles: outputFiles.sort(),
      };
      return JSON.stringify(state);
    },
  });
  return { candidateCount: candidates.length, conceptCount: concepts.length,
    added, changed, deleted, reusedSources, reusedGroups, rebuiltGroups, skipped: false };
}
