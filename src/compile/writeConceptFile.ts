import { WikiConcept } from "@/types/concept";
import { writeMarkdownFile } from "@/utils/writeMarkdownFile";

/**
 * 把最终概念转换为 Wiki Markdown。
 *
 * @param concept 已完成跨来源综合的概念。
 * @returns 可直接交给 Markdown 写入器的 Frontmatter 与正文。
 */
export function createConceptMarkdown(concept: WikiConcept) {
  const frontmatter = {
    title: concept.name,
    summary: concept.summary,
    sources: concept.sources,
    createdAt: concept.createdAt,
    updatedAt: concept.updatedAt,
    tags: concept.tags,
    aliases: concept.aliases,
    confidence: concept.confidence,
    modelId: concept.modelId,
  };

  const relatedConcepts = concept.relatedConcepts.length > 0
    ? concept.relatedConcepts
      .map((name) => `- [[${name}]]`)
      .join("\n")
    : "暂无相关概念。";

  const evidence = concept.evidence.length > 0
    ? concept.evidence
      .map(({ sourceFileName, startLine, endLine }) =>
        `- [[${sourceFileName}:${startLine}-${endLine}]]`)
      .join("\n")
    : "暂无原文证据。";

  return {
    frontmatter,
    content: `# ${concept.name}

${concept.content}

## 相关概念

${relatedConcepts}

## 原文证据

${evidence}
`,
  };
}

/**
 * 将最终概念分别写入指定目录。
 *
 * 文件名清理由通用 Markdown 写入器统一处理，避免不同编译阶段产生不同文件名。
 *
 * @param concepts 已完成综合的概念列表。
 * @param outputDirectory 相对于当前工作目录的输出目录。
 */
export async function writeConceptFiles(
  concepts: readonly WikiConcept[],
  outputDirectory = "wiki/concepts",
): Promise<void> {
  for (const concept of concepts) {
    const { frontmatter, content } = createConceptMarkdown(concept);

    await writeMarkdownFile(concept.name, content, {
      directory: outputDirectory,
      frontmatter,
    });
  }
}
