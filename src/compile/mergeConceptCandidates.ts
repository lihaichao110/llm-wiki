import { parseConceptExtractionJson } from "@/compile/parseConceptExtraction";
import {
  ConceptCandidate,
  ConceptCandidateGroup,
  ExtractedConcept,
  WikiConcept,
  WikiConceptEvidence,
} from "@/types/concept";
import { LlmMessage } from "@/types/llm";
import { LlmProvider } from "@/types/provider";
import { isRecord } from "@/utils/is";
import { normalizeConceptName } from "@/utils/name";

/**
 * 按规范化名称将概念候选划分为稳定、平坦的分组。
 *
 * @param candidates 按 source 处理顺序产生的概念候选。
 * @returns 保持首次出现顺序的候选分组。
 * @throws 概念名称无法生成有效分组键时抛出异常。
 */
export function mergeConceptCandidates(
  candidates: readonly ConceptCandidate[],
): ConceptCandidateGroup[] {
  /** Map 会保留键首次插入时的顺序，从而保证输出稳定。 */
  const groups = new Map<string, ConceptCandidateGroup>();

  for (const candidate of candidates) {
    const normalizedName = normalizeConceptName(candidate.concept.name);
    if (!normalizedName) {
      throw new Error(`概念名称无法生成有效分组键：${candidate.concept.name}`);
    }

    const existingGroup = groups.get(normalizedName);
    if (existingGroup) {
      existingGroup.candidates.push(candidate);
      continue;
    }

    groups.set(normalizedName, {
      normalizedName,
      candidates: [candidate],
    });
  }

  return Array.from(groups.values());
}

/**
 * 构造跨来源概念综合提示词。
 *
 * 模型只负责整理语义字段；来源、证据和时间均由程序确定性生成。
 */
function buildConceptMergeMessages(group: ConceptCandidateGroup): LlmMessage[] {
  const systemPrompt = `
你是一名知识库编译器，需要把多个来源对同一概念的描述综合成一个概念页面。

规则：
1. 只能使用候选数据中明确支持的信息，不得补充外部知识。
2. 消除重复内容；遇到无法消解的冲突时，只保留候选共同支持的表述。
3. name 必须保持为同一概念的标准名称，不得改成其他概念。
4. aliases、tags、keyPoints 和 relatedConcepts 应去重。
5. content 不包含 Frontmatter、一级标题、相关概念章节或原文证据章节。
6. 不得输出 source、evidence、行号、模型或时间信息。
7. 只返回合法 JSON，不要使用 Markdown 代码块，也不要添加解释。

返回格式：
{
  "concept": {
    "name": "概念名称",
    "aliases": ["别名"],
    "summary": "概念简介",
    "tags": ["标签"],
    "confidence": 0.9,
    "content": "综合后的 Markdown 正文。",
    "keyPoints": ["核心知识点"],
    "relatedConcepts": ["相关概念名称"]
  }
}
`.trim();

  const userPrompt = `
请综合下面这些规范化名称相同的概念候选。

${JSON.stringify({
    normalizedName: group.normalizedName,
    candidates: group.candidates.map((candidate) => ({
      sourceFileName: candidate.sourceFileName,
      concept: candidate.concept,
    })),
  }, null, 2)}
`.trim();

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

/**
 * 解析并校验模型返回的单个综合概念。
 */
function parseMergedConcept(
  rawJson: string,
  group: ConceptCandidateGroup,
): ExtractedConcept {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`概念综合结果不是有效 JSON：${reason}`);
  }

  if (!isRecord(parsedValue) || !isRecord(parsedValue.concept)) {
    throw new Error("概念综合结果必须包含一个 concept 对象");
  }

  const firstCandidate = group.candidates[0];
  const validationResult = parseConceptExtractionJson(
    JSON.stringify({
      concepts: [{ ...parsedValue.concept, evidence: [] }],
    }),
    {
      sourceFileName: firstCandidate.sourceFileName,
      modelId: firstCandidate.modelId,
      createdAt: firstCandidate.extractedAt,
      updatedAt: firstCandidate.extractedAt,
    },
  );
  const concept = validationResult.concepts[0];

  if (normalizeConceptName(concept.name) !== group.normalizedName) {
    throw new Error(
      `综合后的概念名称与原分组不一致：${concept.name}（预期 ${group.normalizedName}）`,
    );
  }

  return concept;
}

/**
 * 合并候选携带的来源和证据，并保持稳定顺序。
 */
function collectCandidateContext(group: ConceptCandidateGroup): {
  sources: string[];
  evidence: WikiConceptEvidence[];
  modelId: string;
  createdAt: string;
  updatedAt: string;
} {
  const sources: string[] = [];
  const sourceSet = new Set<string>();
  const evidence: WikiConceptEvidence[] = [];
  const evidenceSet = new Set<string>();
  const modelIds = new Set(group.candidates.map((candidate) => candidate.modelId));

  if (modelIds.size !== 1) {
    throw new Error(`同一概念候选使用了不同模型：${Array.from(modelIds).join(", ")}`);
  }

  for (const candidate of group.candidates) {
    if (!sourceSet.has(candidate.sourceFileName)) {
      sourceSet.add(candidate.sourceFileName);
      sources.push(candidate.sourceFileName);
    }

    for (const item of candidate.concept.evidence) {
      const evidenceKey = JSON.stringify([
        candidate.sourceFileName,
        item.text,
        item.startLine,
        item.endLine,
      ]);
      if (evidenceSet.has(evidenceKey)) {
        continue;
      }

      evidenceSet.add(evidenceKey);
      evidence.push({
        ...item,
        sourceFileName: candidate.sourceFileName,
      });
    }
  }

  /** 正常编译时所有候选共用时间；排序可兼容手工构造的候选。 */
  const extractedTimes = group.candidates
    .map((candidate) => candidate.extractedAt)
    .sort();

  return {
    sources,
    evidence,
    modelId: group.candidates[0].modelId,
    createdAt: extractedTimes[0],
    updatedAt: extractedTimes[extractedTimes.length - 1],
  };
}

/**
 * 将候选分组转换为可以直接写入 Wiki 的概念。
 *
 * 单候选直接转换，多候选通过模型综合语义字段。任何一组失败都会终止整轮编译。
 *
 * @param groups 已按规范化名称整理的候选分组。
 * @param provider 本轮编译共用的大模型实现。
 */
export async function mergeConceptCandidateGroups(
  groups: readonly ConceptCandidateGroup[],
  provider: LlmProvider,
): Promise<WikiConcept[]> {
  const concepts: WikiConcept[] = [];

  for (const group of groups) {
    if (group.candidates.length === 0) {
      throw new Error(`概念分组 ${group.normalizedName} 不包含候选`);
    }

    const semanticConcept = group.candidates.length === 1
      ? group.candidates[0].concept
      : parseMergedConcept(
        await provider.generateText(buildConceptMergeMessages(group), {
          responseFormat: "json",
          temperature: 0,
        }),
        group,
      );
    const context = collectCandidateContext(group);

    concepts.push({
      ...semanticConcept,
      ...context,
      evidence: context.evidence,
    });
  }

  return concepts;
}
