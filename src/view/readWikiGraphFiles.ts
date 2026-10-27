import { FRONTMATTER_PATTERN } from "@/tools/shared";
import type { WikiGraphNode } from "@/view/readWikiGraph";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** 解析期间暂存概念页及其显式关联名称。 */
export interface ConceptPage {
  node: WikiGraphNode;
  relatedNames: string[];
}

/** index 中的摘要用于缺少 Frontmatter 摘要时补齐展示信息。 */
export interface IndexEntry {
  title: string;
  summary: string;
}

/** index 中的所有 Wiki 链接均是目录引用，首次出现决定展示顺序。 */
const INDEX_LINK_PATTERN = /\[\[([^\]\r\n]+)\]\]/g;

/** 生成的目录列表项可以额外提供概念摘要。 */
const INDEX_SUMMARY_PATTERN = /^\s*-\s+(?:\*\*)?\[\[([^\]\r\n]+)\]\](?:\*\*)?\s*-\s*(.*)$/;

/** `相关概念` 章节列表中的 Wiki 链接。 */
const RELATED_LINK_PATTERN = /^\s*-\s+\[\[([^\]\r\n]+)\]\]/;

/**
 * 仅提取“相关概念”二级标题下的列表链接。
 *
 * @param markdown 完整概念 Markdown。
 * @returns 该章节中按原顺序出现的概念名称。
 */
export function readRelatedNames(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const relatedNames: string[] = [];
  let inRelatedSection = false;

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inRelatedSection = /^##\s+相关概念\s*$/.test(line);
      continue;
    }
    if (inRelatedSection && /^#{1,2}\s+/.test(line)) {
      break;
    }
    if (!inRelatedSection) {
      continue;
    }

    const match = line.match(RELATED_LINK_PATTERN);
    if (match) {
      relatedNames.push(match[1].trim());
    }
  }

  return relatedNames;
}

/**
 * 读取 index 的标题和目录引用。
 *
 * @param wikiDirectory Wiki 根目录的绝对路径。
 * @returns index 标题及按文件顺序排列的概念引用。
 * @throws index 缺失、没有目录引用或无法读取时抛出错误。
 */
export async function readIndexEntries(
  wikiDirectory: string,
): Promise<{ title: string; entries: IndexEntry[] }> {
  let markdown: string;
  try {
    markdown = await readFile(path.join(wikiDirectory, "index.md"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("未找到 wiki/index.md，请先运行 llm-wiki compile。", { cause: error });
    }
    throw error;
  }

  const entries: IndexEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const summaryMatch = line.match(INDEX_SUMMARY_PATTERN);
    for (const [, name] of line.matchAll(INDEX_LINK_PATTERN)) {
      entries.push({
        title: name.trim(),
        summary: summaryMatch?.[1].trim() === name.trim() ? summaryMatch[2].trim() : "",
      });
    }
  }
  if (entries.length === 0) {
    throw new Error("wiki/index.md 没有有效目录项，请先运行 llm-wiki compile。");
  }
  return {
    title: markdown.match(/^#\s+(.+?)\s*$/m)?.[1].trim() || "Wiki 索引",
    entries,
  };
}

/**
 * 解析 YAML 元数据和显式关系；单个损坏页面会被跳过并报告。
 *
 * @param filePath 概念文件的绝对路径。
 * @param fileName 概念文件名，用作稳定节点 ID。
 * @returns 可用概念页；格式无效时返回错误说明。
 */
export async function readConceptPage(
  filePath: string,
  fileName: string,
): Promise<{ page?: ConceptPage; warning?: string }> {
  let markdown: string;
  try {
    markdown = await readFile(filePath, "utf8");
  } catch (error) {
    return { warning: `${fileName} 读取失败：${error instanceof Error ? error.message : String(error)}` };
  }

  const frontmatterMatch = markdown.match(FRONTMATTER_PATTERN);
  if (!frontmatterMatch) {
    return { warning: `${fileName} 缺少有效的 YAML Frontmatter，已跳过。` };
  }

  try {
    const metadata: unknown = parseYaml(frontmatterMatch[1]);
    if (
      typeof metadata !== "object"
      || metadata === null
      || !("title" in metadata)
      || typeof metadata.title !== "string"
      || !metadata.title.trim()
    ) {
      return { warning: `${fileName} 缺少有效标题，已跳过。` };
    }

    const record = metadata as Record<string, unknown>;
    const stringArray = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
      : [];

    return {
      page: {
        node: {
          id: fileName,
          kind: "concept",
          title: metadata.title.trim(),
          summary: typeof record.summary === "string" ? record.summary.trim() : "",
          tags: stringArray(record.tags),
          aliases: stringArray(record.aliases),
        },
        relatedNames: readRelatedNames(markdown.slice(frontmatterMatch[0].length)),
      },
    };
  } catch (error) {
    return { warning: `${fileName} 的 YAML 无法解析：${error instanceof Error ? error.message : String(error)}` };
  }
}

