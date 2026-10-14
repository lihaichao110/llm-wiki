import type { EmbeddingInfo } from '@/types/embedding';
import { createEmbedding } from '@/vector/createEmbedding';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** 单次最多交给模型的相关条目数量，控制检索上下文规模。 */
const MAX_RESULTS = 6;

/** 可直接展示给用户的 Wiki 检索结果。 */
export interface WikiSearchResult {
  fileName: string;
  text: string;
  score: number;
}

/**
 * 计算两个等长非零向量的余弦相似度。
 *
 * @param left 问题向量。
 * @param right Wiki 内容向量。
 * @returns 相似度；维度不一致或向量无效时返回 null。
 */
function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) {
    return null;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return null;
    }
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

/**
 * 按问题向量与 Wiki 向量的相似度选出最相关内容。
 *
 * @param queryEmbedding 问题的浮点向量。
 * @param embeddings 从向量文件读取的记录。
 * @returns 相似度由高到低排列的结果。
 */
export function rankWikiEmbeddings(
  queryEmbedding: number[],
  embeddings: EmbeddingInfo[],
): WikiSearchResult[] {
  return embeddings.flatMap((item) => {
    // vector 命令写入浮点数组；旧文件或其他编码格式暂不参与检索。
    if (!item || !Array.isArray(item.embedding) || typeof item.text !== 'string' || typeof item.file_name !== 'string') {
      return [];
    }

    const score = cosineSimilarity(queryEmbedding, item.embedding);
    return score === null ? [] : [{ fileName: item.file_name, text: item.text, score }];
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RESULTS);
}

/**
 * 读取当前项目的向量索引，再用相同模型为问题生成向量并检索。
 *
 * @param question 用户提出的问题。
 * @returns 相似度最高的 Wiki 内容。
 * @throws 向量文件缺失、格式错误、向量生成失败或没有兼容向量时抛出错误。
 */
export async function searchWiki(question: string): Promise<WikiSearchResult[]> {
  const indexPath = path.resolve(process.cwd(), '.llmwiki/embedding.json');
  let content: string;

  try {
    content = await readFile(indexPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('未找到 Wiki 向量索引，请先运行 llm-wiki vector。');
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Wiki 向量索引不是有效的 JSON，请重新运行 llm-wiki vector。');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Wiki 向量索引格式错误，请重新运行 llm-wiki vector。');
  }

  if (parsed.length === 0) {
    throw new Error('Wiki 向量索引中没有可检索的内容，请先运行 llm-wiki vector。');
  }

  // 查询与 vector 命令使用同一个向量模型，以便比较相似度。
  const [queryEmbedding] = await createEmbedding(question, '[query]');
  if (!queryEmbedding || !Array.isArray(queryEmbedding.embedding)) {
    throw new Error('未能生成可用于检索的问题向量。');
  }

  const results = rankWikiEmbeddings(queryEmbedding.embedding, parsed as EmbeddingInfo[]);
  if (results.length === 0) {
    throw new Error('Wiki 向量索引中没有可检索的内容，请先运行 llm-wiki vector。');
  }

  return results;
}
