import { FRONTMATTER_PATTERN, SourceTypeEnum } from "@/tools/shared";
import type { SourceDocument, SourceFrontmatter } from "@/types/document";
import { isRecord } from "@/utils/is";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { parse as parseYaml } from "yaml";

/**
 * 校验并转换 source 文件的 Frontmatter。
 *
 * @param value YAML 解析后的未知数据。
 * @param filePath 当前文件路径，用于生成明确的错误信息。
 * @returns 经过校验的 Frontmatter。
 */
function validateFrontmatter(
  value: unknown,
  filePath: string,
): SourceFrontmatter {
  if (!isRecord(value)) {
    throw new Error(`${filePath} 的 Frontmatter 必须是一个对象`);
  }

  if (typeof value.title !== "string" || value.title.trim() === "") {
    throw new Error(`${filePath} 的 Frontmatter 缺少有效的 title`);
  }

  if (typeof value.source !== "string" || value.source.trim() === "") {
    throw new Error(`${filePath} 的 Frontmatter 缺少有效的 source`);
  }

  if (typeof value.sourceType !== "string" || value.sourceType.trim() === "") {
    throw new Error(`${filePath} 的 Frontmatter 缺少有效的 sourceType`);
  }

  return {
    ...value,
    title: value.title?.trim(),
    source: value.source?.trim(),
    sourceType: (value.sourceType?.trim() as SourceTypeEnum)
  };
}

/**
 * 读取并解析一个 source Markdown 文件。
 *
 * @param filePath Markdown 文件的绝对路径。
 * @returns Frontmatter、Markdown 正文和文件路径。
 */
export async function parseSourceFile(filePath: string): Promise<SourceDocument | null> {
  const rawMarkdown = await readFile(filePath, "utf8");

  // Frontmatter 必须出现在文件开头，并使用三条横线包围。
  const frontmatterMatch = rawMarkdown.match(FRONTMATTER_PATTERN);

  if (!frontmatterMatch) {
    console.log(chalk.red(`${filePath} 缺少有效的 Frontmatter`));
    return null
  }

  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(frontmatterMatch[1]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`${filePath} 的 Frontmatter YAML 解析失败：${reason}`));
  }

  const frontmatter = validateFrontmatter(parsedYaml, filePath);
  const content = rawMarkdown.slice(frontmatterMatch[0].length).trim()

  return {
    filePath,
    frontmatter,
    content,
  };
}