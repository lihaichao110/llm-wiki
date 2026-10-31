import { ConceptCandidate, ConceptCandidateGroup, ExtractedConcept, WikiConcept } from "@/types/concept";
import { SourceDocument } from "@/types/document";
import { isRecord } from "@/utils/is";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createSourceHash } from "./createSourceHash";

/** 成功编译状态的默认路径。 */
export const STATE_JSON = ".llmwiki/state.json";

/** 一个 source 的提取结果；空数组表示该文件成功提取但没有概念。 */
export interface CachedSource {
  hash: string;
  candidates: ConceptCandidate[];
}

/** 一个概念组的综合结果。 */
export interface CachedGroup {
  signature: string;
  concept: WikiConcept;
}

/** 与当前 Wiki 快照一同发布的缓存。 */
export interface CompileState {
  version: 2;
  modelId: string;
  baseURL: string;
  sources: Record<string, CachedSource>;
  groups: Record<string, CachedGroup>;
  outputFiles: string[];
}

/**
 * 返回 source 在扫描目录中的相对路径，作为缓存键和概念来源。
 * @param document 已解析的 source。
 * @param sourcesDirectory 扫描根目录。
 * @returns 使用正斜杠的相对路径；越界时抛错。
 */
export function sourceKeyFor(document: SourceDocument, sourcesDirectory: string): string {
  const key = path.relative(path.resolve(sourcesDirectory), path.resolve(document.filePath));
  if (!key || key === ".." || key.startsWith(`..${path.sep}`) || path.isAbsolute(key)) {
    throw new Error(`source 路径超出 sources 目录：${document.filePath}`);
  }
  return key.split(path.sep).join("/");
}

/**
 * 只哈希进入提取 Prompt 的字段，其他 Frontmatter 变化不触发编译。
 * @param document 已解析的 source。
 * @returns 提取输入的 SHA-256 哈希。
 */
export function sourceInputHash(document: SourceDocument): string {
  const { title, source, sourceType } = document.frontmatter;
  return createSourceHash({ title, source, sourceType, content: document.content });
}

/** 当前 source 与上轮成功状态的比较结果，供检查阶段和编译共用。 */
export interface SourceComparison {
  current: Map<string, { document: SourceDocument; hash: string }>;
  added: number;
  changed: number;
  deleted: number;
  unchanged: number;
}

/**
 * 按进入模型的实际输入比较全部资料，避免检查和编译使用不同的变更口径。
 * @param documents 当前有效的 source。
 * @param saved 上轮成功状态；缺失时全部视为新增。
 * @param sourcesDirectory source 根目录。
 * @returns 路径与哈希快照，以及四类资料数量。
 * @throws 同一路径重复出现或资料路径超出根目录时抛错。
 */
export function compareSourceDocuments(
  documents: readonly SourceDocument[],
  saved: CompileState | null,
  sourcesDirectory = "sources",
): SourceComparison {
  /** 相对路径同时作为缓存键和删除检测的依据。 */
  const current = new Map<string, { document: SourceDocument; hash: string }>();
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const document of documents) {
    const key = sourceKeyFor(document, sourcesDirectory);
    if (current.has(key)) throw new Error(`重复的 source 路径：${key}`);
    const hash = sourceInputHash(document);
    current.set(key, { document, hash });
    const previousHash = saved?.sources[key]?.hash;
    if (previousHash === undefined) added += 1;
    else if (previousHash === hash) unchanged += 1;
    else changed += 1;
  }
  const deleted = Object.keys(saved?.sources ?? {}).filter((key) => !current.has(key)).length;
  return { current, added, changed, deleted, unchanged };
}

/**
 * 忽略提取时间，仅用实际参与综合的候选内容判断概念组是否变化。
 * @param group 当前候选分组。
 * @returns 候选内容的 SHA-256 签名。
 */
export function groupSignature(group: ConceptCandidateGroup): string {
  return createSourceHash({
    name: group.normalizedName,
    candidates: group.candidates.map(({ sourceFileName, concept }) => ({ sourceFileName, concept })),
  });
}

/**
 * 检查缓存中的字符串数组是否具备可复用的基础结构。
 * @param value 状态文件中的未知字段。
 * @returns 全部元素都是字符串时为 true。
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

/**
 * 检查证据字段的基础类型，避免复用时访问缺失的行号或文本。
 * @param value 状态文件中的证据。
 * @returns 证据字段类型完整时为 true。
 */
function validEvidence(value: unknown): boolean {
  return isRecord(value) && typeof value.text === "string"
    && typeof value.startLine === "number" && typeof value.endLine === "number";
}

/**
 * 检查概念在分组和输出阶段会使用的字段类型，不重新做语义校验。
 * @param value 状态文件中的概念。
 * @returns 概念基础结构完整时为 true。
 */
function validConcept(value: unknown): value is ExtractedConcept {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.summary === "string"
    && typeof value.content === "string" && typeof value.confidence === "number"
    && isStringArray(value.aliases) && isStringArray(value.tags)
    && isStringArray(value.keyPoints) && isStringArray(value.relatedConcepts)
    && Array.isArray(value.evidence) && value.evidence.every(validEvidence);
}

/**
 * 只检查缓存格式与复用所需字段的类型；内容对应关系留给后续需要时扩展。
 * @param value 从状态文件解析出的未知数据。
 * @returns 缓存基础结构完整时为 true。
 */
function validState(value: unknown): value is CompileState {
  if (!isRecord(value) || value.version !== 2 || typeof value.modelId !== "string"
    || typeof value.baseURL !== "string" || !isRecord(value.sources)
    || !isRecord(value.groups) || !isStringArray(value.outputFiles)) return false;

  const validSources = Object.values(value.sources).every((source) => isRecord(source)
    && typeof source.hash === "string" && Array.isArray(source.candidates)
    && source.candidates.every((candidate: unknown) => isRecord(candidate)
      && typeof candidate.sourceFileName === "string"
      && typeof candidate.modelId === "string"
      && typeof candidate.extractedAt === "string"
      && validConcept(candidate.concept)));
  if (!validSources) return false;

  return Object.values(value.groups).every((group) => isRecord(group)
    && typeof group.signature === "string" && isRecord(group.concept)
    && validConcept(group.concept) && isStringArray(group.concept.sources)
    && typeof group.concept.modelId === "string"
    && typeof group.concept.createdAt === "string"
    && typeof group.concept.updatedAt === "string"
    && group.concept.evidence.every((item: unknown) => isRecord(item)
      && typeof item.sourceFileName === "string"));
}

/**
 * 读取上轮成功状态；缺失、旧版或损坏时返回 null。
 * @param stateFilePath 状态路径。
 * @returns 可复用状态，或触发完整重编译的 null。
 * @throws 读取错误及路径类型错误继续上抛。
 */
export async function readCompileState(stateFilePath = STATE_JSON): Promise<CompileState | null> {
  try {
    if (!(await lstat(stateFilePath)).isFile()) {
      throw new Error(`目标路径类型不符合预期：${path.resolve(stateFilePath)}`);
    }
    const content = await readFile(stateFilePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    return validState(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error
      && error.code === "ENOENT")) return null;
    throw error;
  }
}

/**
 * 检查索引和状态记录的概念文件是否齐全。
 * @param state 上轮成功状态。
 * @param outputDirectory 概念文件目录。
 * @returns 产物齐全时为 true。
 */
export async function hasCompleteOutput(
  state: CompileState,
  outputDirectory = "wiki/concepts",
): Promise<boolean> {
  const directory = path.resolve(outputDirectory);
  try {
    if (!(await lstat(path.join(path.dirname(directory), "index.md"))).isFile()) return false;
    const entries = await readdir(directory, { withFileTypes: true });
    const expected = new Set(state.outputFiles);
    return entries.length === expected.size
      && entries.every((entry) => entry.isFile() && expected.has(entry.name));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
