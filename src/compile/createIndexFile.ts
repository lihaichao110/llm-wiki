import { writeFile } from "node:fs/promises";
import { WikiConcept } from "@/types/concept";

/**
 * 为指定 Wiki 输出目录写入概念索引。
 *
 * @param concepts 已成功写入的概念快照。
 * @param indexFilePath 与概念目录同级的索引文件绝对路径。
 * @returns 索引写入完成后兑现的 Promise。
 * @throws 索引文件无法写入时抛出文件系统异常。
 */
export async function createIndexFiles(
  concepts: readonly WikiConcept[],
  indexFilePath: string,
): Promise<void> {
  const data = concepts.map((item) =>
    `- **[[${item.name}]]** - ${item.summary}`,
  ).join("\n");

  const article = `
# llm-wiki

${data}

${concepts.length} pages | Generated ${new Date().toISOString()}
`;
  await writeFile(indexFilePath, article, "utf8");
}
