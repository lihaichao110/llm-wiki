import { ConceptMarkdownOptions, ExtractedConcept } from "@/types/concept";
import { writeMarkdownFile } from "@/utils/writeMarkdownFile";

/**
 * 将概念名称转换为安全的 Markdown 文件名。
 */
function createConceptFileName(name: string): string {
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/\.+$/g, "");

  return `${safeName || "未命名概念"}.md`;
}

/**
 * 把概念转换为 Wiki Markdown。
 *
 * sources 使用数组为后续合并多个来源预留空间；当前每次编译只写入本次来源。
 *
 * @param concept - 从 source 文档提取出的概念。
 * @param options - 概念来源、模型和时间信息。
 * @returns 可直接交给 Markdown 写入器的 Frontmatter 与正文。
 */
function createConceptMarkdown(concept: ExtractedConcept, options: ConceptMarkdownOptions) {
  const frontmatter = {
    title: concept.name,
    summary: concept.summary,
    sources: [options.sourceFileName],
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    tags: concept.tags,
    aliases: concept.aliases,
    confidence: concept.confidence,
    modelId: options.modelId,
  };

  const relatedConcepts = concept.relatedConcepts.length > 0
    ? concept.relatedConcepts
      .map((name) => `- [[${name}]]`)
      .join("\n")
    : "暂无相关概念。";

  const evidence = concept.evidence.length > 0
    ? concept.evidence?.map(opt => (`- [[${options.sourceFileName}:${opt.startLine}-${opt.endLine}]]\n`))
    : ''

  return {
    frontmatter,
    content: `
# ${concept.name}

${concept.content}

## 相关概念

${relatedConcepts}

## 原文证据

${evidence}
`
  }
}

/**
 * 将提取出的概念分别写入 wiki/concepts 目录。
 *
 * 同名概念沿用通用的来源保护逻辑，后续再实现跨来源的概念合并。
 */
export async function writeConceptFiles(
  concepts: readonly ExtractedConcept[],
  options: ConceptMarkdownOptions,
  outputDirectory = "wiki/concepts",
): Promise<void> {
  for (const concept of concepts) {
    const fileName = createConceptFileName(concept.name);
    const { frontmatter, content } = createConceptMarkdown(concept, options);

    await writeMarkdownFile(fileName, content, {
      directory: outputDirectory,
      frontmatter,
    });
  }
}
