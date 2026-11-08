/**
 * 单条文本分块对应的向量记录，也是 `.llmwiki/embedding.json` 的记录格式。
 */
export interface EmbeddingInfo {
  /** OpenRouter 本次 embedding 响应的 ID；部分兼容服务可能不返回。 */
  id?: string;
  /** 实际生成向量时使用的模型。 */
  model: string;
  /** 向量值；SDK 支持浮点数组或 base64 编码字符串。 */
  embedding: number[] | string;
  /** 向量在本次输入中的序号；响应可能省略该字段。 */
  chunk_index?: number;
  /** 生成该向量的原始文本。 */
  text: string;
  /** 原始 Markdown 文件名。 */
  file_name: string;
}

/** v2 索引中的片段向量，位置指向本片段新增正文的原始行。 */
export interface ChunkEmbeddingInfo extends EmbeddingInfo {
  /** 从概念标题到当前章节的标题路径。 */
  section_path: string[];
  /** 片段在概念文件中的零基序号。 */
  position: number;
  /** 新增正文在概念文件中的起始行。 */
  start_line: number;
  /** 新增正文在概念文件中的结束行。 */
  end_line: number;
}

/** 向量索引的磁盘格式；版本字段用于阻止旧整篇索引参与片段检索。 */
export interface EmbeddingIndex {
  version: 2;
  embeddings: ChunkEmbeddingInfo[];
}
