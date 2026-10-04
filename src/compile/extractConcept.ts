import { SourceDocument } from "@/types/document";
import { LlmProvider } from "@/types/provider";
import { buildConceptExtractionMessages, ConceptPromptOptions } from "./buildConceptPrompt";
import { ConceptExtractionResult, ConceptMarkdownOptions } from "@/types/concept";
import { parseConceptExtractionJson } from "./parseConceptExtraction";

/**
 * 使用大模型从一篇 source 文档中提取知识概念。
 *
 * 该函数负责连接下面三个阶段：
 * SourceDocument → Prompt → 模型 JSON → 校验结果。
 *
 * @param document 已经解析完成的 source 文档。
 * @param provider 大模型实现。
 * @param markdownOptions 文件配置
 * @param promptOptions Prompt 配置。
 * @returns 经过严格校验的概念提取结果。
 */
export async function extractConceptsFromDocument(
  document: SourceDocument,
  provider: LlmProvider,
  markdownOptions: ConceptMarkdownOptions,
  promptOptions: ConceptPromptOptions = {},
): Promise<ConceptExtractionResult> {
  const messages = buildConceptExtractionMessages(
    document,
    promptOptions,
  );

  const rawResult = await provider.generateText(messages, {
    responseFormat: "json",
  });

  return parseConceptExtractionJson(rawResult, markdownOptions);
}