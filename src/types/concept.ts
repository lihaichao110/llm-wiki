export interface ConceptEvidence {
  /** 支撑概念的原文内容。 */
  text: string;

  /** 证据在 source 正文中的起始行。 */
  startLine: number;

  /** 证据在 source 正文中的结束行。 */
  endLine: number;
}

/**
 * 从一篇 source 文档中提取出的知识概念。
 */
export interface ExtractedConcept {
  /** 概念的标准名称，例如“工作量证明”。 */
  name: string;

  /** 概念可能存在的其他名称。 */
  aliases: string[];

  /** 对概念的简短解释。 */
  summary: string;

  /** 用于组织和搜索概念的标签。 */
  tags: string[];

  /** 模型对概念提取结果的置信度，范围为 0～1。 */
  confidence: number;

  /** 概念包含的核心知识点。 */
  keyPoints: string[];

  /**
   * 整理后的概念 Markdown 正文。
   *
   * 不包含 Frontmatter、一级标题和 Sources 章节。
  */
  content: string;

  /** 与当前概念有关的其他概念名称。 */
  relatedConcepts: string[];

  /** 支撑当前概念的原文片段。 */
  evidence: ConceptEvidence[];

}

/**
 * 文章配置
 */
export interface ConceptMarkdownOptions {
  /** 当前概念来自哪个 source 文件。 */
  sourceFileName: string;

  /** 执行概念提取所使用的模型。 */
  modelId: string;

  /** 概念首次创建时间。 */
  createdAt: string;

  /** 本次更新时间。 */
  updatedAt: string;
}

/**
 * 单篇 source 文档的概念提取结果。
 */
export interface ConceptExtractionResult {
  concepts: ExtractedConcept[];
  options: ConceptMarkdownOptions
}