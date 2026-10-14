import { OpenRouter } from '@openrouter/sdk';
import type { EmbeddingInfo } from "@/types/embedding";

/**
 * 为文本分块逐个请求 BGE-M3，并返回与输入顺序一致的向量。
 * @param input 待向量化的非空文本或文本分块数组。
 * @param fileName 原始文件名；查询问题使用标记名称。
 * @returns 与输入顺序一致、可用于相似度计算的浮点向量记录。
 * @throws OPENROUTER_API_KEY 未配置、请求失败或响应格式异常时抛出带上下文的错误。
 */
export async function createEmbedding(input: string | string[], fileName: string): Promise<EmbeddingInfo[]> {
  const token = process.env.OPENROUTER_API_KEY;
  if (!token) {
    throw new Error('缺少 OPENROUTER_API_KEY。请设置具有 Inference 权限的 OpenRouter Access Token。');
  }
  // splitMarkdown 目前返回单个字符串；保留数组形式以兼容后续分块实现。
  const contents = typeof input === "string" ? [input] : input;
  if (contents.length === 0 || contents.some((content) => !content.trim())) {
    throw new Error("embedding 输入必须是非空文本或非空文本数组。");
  }

  /** 保留输入顺序，作为后续 JSON 存储和检索的强类型记录。 */
  const embeddingsInfoList: EmbeddingInfo[] = [];
  for (const content of contents) {
    const openrouter = new OpenRouter({
      apiKey: token
    });
    try {
      const response = await openrouter.embeddings.generate({
        requestBody: {
          model: "baai/bge-m3",
          input: content,
          encodingFormat: "float"
        }
      });

      // 查询只接受可计算相似度的浮点向量，不能把 base64 或空结果写入索引。
      if (typeof response === 'string' || !Array.isArray(response.data) || response.data.length === 0) {
        throw new Error('未返回有效的浮点向量。');
      }
      for (const vectorItem of response.data) {
        const embedding = vectorItem.embedding;
        if (!Array.isArray(embedding) || embedding.length === 0 ||
          !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          throw new Error('未返回有效的浮点向量。');
        }
        embeddingsInfoList.push({
          id: response.id,
          model: response.model,
          embedding,
          chunk_index: vectorItem.index,
          text: content,
          file_name: fileName,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? error.cause : undefined;
      const causeDetails =
        cause instanceof Error
          ? `${cause.message}${"code" in cause ? ` (${String(cause.code)})` : ""}`
          : undefined;
      throw new Error(
        `连接 OpenRouter Inference API 失败：${reason}${causeDetails ? `；底层原因：${causeDetails}` : ""}`
      );
    }
  }

  return embeddingsInfoList;
}
