import { SourceDocument } from "@/types/document";
import { LlmProvider } from "@/types/provider";
import { buildConceptExtractionMessages, ConceptPromptOptions } from "./buildConceptPrompt";
import {
  ConceptCandidate,
  ConceptExtractionResult,
  ConceptMarkdownOptions,
} from "@/types/concept";
import { parseConceptExtractionJson } from "./parseConceptExtraction";
import { extractFilePath } from "@/utils/name";
import { ExtractAllConceptsOptions } from "@/types/compile";

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
    // 概念目录需要尽量稳定，避免同一文档因采样随机性产生明显差异。
    temperature: 0,
  });

  return parseConceptExtractionJson(rawResult, markdownOptions);
}


/**
 * 按指定并发量从全部 source 文档中提取概念。
 *
 * worker 会并行领取文档，但结果仍按照 documents 的输入顺序返回，保证相同输入下
 * 后续概念合并和 Wiki 文件生成的顺序稳定。任意文档提取失败时函数整体失败，调用方
 * 不应继续覆盖现有 Wiki。
 *
 * @param documents 本轮需要提取概念的全部 source 文档。
 * @param provider 本轮编译共用的大模型实现。
 * @param options 并发数、模型名称和本轮提取时间。
 * @returns 携带来源信息的全部概念候选。
 * @throws 并发量非法或任意文档提取失败时抛出异常。
 */
export async function extractAllConcepts(
  documents: readonly SourceDocument[],
  provider: LlmProvider,
  options: ExtractAllConceptsOptions,
): Promise<ConceptCandidate[]> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("并行提取数量必须是大于等于 1 的安全整数");
  }

  if (documents.length === 0) {
    return [];
  }

  /** 同一轮编译共用时间，避免并发请求完成顺序影响生成结果。 */
  const extractedAt = options.extractedAt ?? new Date().toISOString();
  /** 按输入下标存放结果，用于消除并发完成顺序带来的不确定性。 */
  const results: ConceptCandidate[][] = new Array(documents.length);
  /** JavaScript 同步递增下标即可保证每份文档只会被一个 worker 领取。 */
  let nextDocumentIndex = 0;

  /**
   * 持续领取并处理下一篇文档，直到全部文档处理完成。
   */
  const runWorker = async (): Promise<void> => {
    while (nextDocumentIndex < documents.length) {
      const documentIndex = nextDocumentIndex;
      nextDocumentIndex += 1;

      const document = documents[documentIndex];
      const sourceFileName = extractFilePath(document.filePath)
      const extractionResult = await extractConceptsFromDocument(
        document,
        provider,
        {
          sourceFileName,
          modelId: options.modelId,
          createdAt: extractedAt,
          updatedAt: extractedAt,
        },
      );

      results[documentIndex] = extractionResult.concepts.map((concept) => {
        const { sourceFileName, modelId, createdAt } = extractionResult.options;
        return {
          concept,
          sourceFileName,
          modelId,
          extractedAt: createdAt,
        };
      });
    }
  };

  /** worker 数不超过文档数，避免创建没有工作的异步任务。 */
  const workerCount = Math.min(options.concurrency, documents.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results.flat();
}
