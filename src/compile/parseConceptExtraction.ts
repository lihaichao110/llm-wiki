import type {
  ConceptEvidence,
  ConceptExtractionResult,
  ConceptMarkdownOptions,
  ExtractedConcept,
} from "@/types/concept";
import { isRecord } from "@/utils/is";

/**
 * 读取必填的非空字符串字段。
 *
 * @param value 字段值。
 * @param fieldPath 字段位置，用于生成错误信息。
 * @returns 去除首尾空格后的字符串。
 */
function readRequiredString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldPath} 必须是非空字符串`);
  }

  return value.trim();
}

/**
 * 读取字符串数组字段。
 *
 * @param value 字段值。
 * @param fieldPath 字段位置，用于生成错误信息。
 * @returns 清理后的字符串数组。
 */
function readStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} 必须是字符串数组`);
  }

  return value.map((item, index) =>
    readRequiredString(item, `${fieldPath}[${index}]`),
  );
}

/**
 * 读取范围为 0～1 的置信度。
 *
 * @param value 模型返回的字段值。
 * @param fieldPath 字段位置，用于生成错误信息。
 */
function readConfidence(value: unknown, fieldPath: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new Error(`${fieldPath} 必须是 0 到 1 之间的数字`);
  }

  return value;
}

/**
 * 读取大于等于 1 的整数行号。
 */
function readLineNumber(value: unknown, fieldPath: string): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
  ) {
    throw new Error(`${fieldPath} 必须是大于等于 1 的整数`);
  }

  return value;
}

/**
 * 读取并校验模型返回的证据数组。
 */
function readEvidenceArray(
  value: unknown,
  fieldPath: string,
): ConceptEvidence[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} 必须是证据对象数组`);
  }

  return value.map((item, index) => {
    const evidencePath = `${fieldPath}[${index}]`;

    if (!isRecord(item)) {
      throw new Error(`${evidencePath} 必须是对象`);
    }

    const startLine = readLineNumber(
      item.startLine,
      `${evidencePath}.startLine`,
    );

    const endLine = readLineNumber(
      item.endLine,
      `${evidencePath}.endLine`,
    );

    if (endLine < startLine) {
      throw new Error(
        `${evidencePath}.endLine 不能小于 startLine`,
      );
    }

    return {
      text: readRequiredString(
        item.text,
        `${evidencePath}.text`,
      ),
      startLine,
      endLine,
    };
  });
}

/**
 * 校验单个概念。
 *
 * @param value 模型返回的概念数据。
 * @param index 概念在数组中的位置。
 * @returns 经过校验的概念。
 */
function validateConcept(value: unknown, index: number): ExtractedConcept {
  const fieldPath = `concepts[${index}]`;

  if (!isRecord(value)) {
    throw new Error(`${fieldPath} 必须是对象`);
  }

  return {
    name: readRequiredString(value.name, `${fieldPath}.name`),
    aliases: readStringArray(value.aliases, `${fieldPath}.aliases`),
    summary: readRequiredString(value.summary, `${fieldPath}.summary`),
    tags: readStringArray(value.tags, `${fieldPath}.tags`),
    confidence: readConfidence(
      value.confidence,
      `${fieldPath}.confidence`,
    ),
    content: readRequiredString(
      value.content,
      `${fieldPath}.content`,
    ),
    keyPoints: readStringArray(
      value.keyPoints,
      `${fieldPath}.keyPoints`,
    ),
    relatedConcepts: readStringArray(
      value.relatedConcepts,
      `${fieldPath}.relatedConcepts`,
    ),
    evidence: readEvidenceArray(
      value.evidence,
      `${fieldPath}.evidence`,
    ),
  };
}


/**
 * 解析并校验大模型返回的概念提取 JSON。
 *
 * @param rawJson 大模型返回的原始 JSON 字符串。
 * @returns 经过类型校验的概念提取结果。
 */
export function parseConceptExtractionJson(
  rawJson: string,
  options: ConceptMarkdownOptions,
): ConceptExtractionResult {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`概念提取结果不是有效 JSON：${reason}`);
  }

  if (!isRecord(parsedValue)) {
    throw new Error("概念提取结果必须是对象");
  }

  if (!Array.isArray(parsedValue.concepts)) {
    throw new Error("concepts 必须是数组");
  }

  return {
    concepts: parsedValue.concepts.map(validateConcept),
    options
  };
}
