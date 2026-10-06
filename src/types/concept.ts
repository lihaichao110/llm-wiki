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
 * 一篇 source 对某个概念的提取结果。
 *
 * 该结构只在单次编译期间使用，为后续跨 source 合并概念保留来源上下文。
 */
export interface ConceptCandidate {
  /** 模型从当前 source 中提取出的概念。 */
  concept: ExtractedConcept;

  /** source 相对于 `sources` 目录的路径。 */
  sourceFileName: string;

  /** 执行概念提取时使用的模型。 */
  modelId: string;

  /** 本轮编译提取概念的时间。 */
  extractedAt: string;
}

/**
 * 规范化名称相同的一组概念候选。
 */
export interface ConceptCandidateGroup {
  /** 由概念名称生成的稳定分组键。 */
  normalizedName: string;

  /** 按 source 处理顺序保存的候选，始终为平坦数组。 */
  candidates: ConceptCandidate[];
}

/**
 * 最终 Wiki 页面使用的原文证据。
 */
export interface WikiConceptEvidence extends ConceptEvidence {
  /** 该证据所属的 source 文件。 */
  sourceFileName: string;
}

/**
 * 完成跨来源综合、可以直接写入 Wiki 的概念。
 */
export interface WikiConcept extends Omit<ExtractedConcept, "evidence"> {
  /** 支撑当前概念的全部 source 文件，按首次出现顺序排列。 */
  sources: string[];

  /** 带 source 上下文的证据，避免跨来源合并后丢失定位信息。 */
  evidence: WikiConceptEvidence[];

  /** 生成当前页面内容所使用的模型。 */
  modelId: string;

  /** 页面首次创建时间。 */
  createdAt: string;

  /** 页面最近一次编译时间。 */
  updatedAt: string;
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
  options: ConceptMarkdownOptions;
}
