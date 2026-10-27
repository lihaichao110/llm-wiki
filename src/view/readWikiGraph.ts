import { normalizeConceptName } from "@/utils/name";
import { readConceptPage, readIndexEntries, type ConceptPage } from "@/view/readWikiGraphFiles";
import { readdir } from "node:fs/promises";
import path from "node:path";

export { readRelatedNames } from "@/view/readWikiGraphFiles";

/** 浏览器展示和检索概念时需要的字段。 */
export interface WikiGraphNode {
  id: string;
  kind: "index" | "concept";
  title: string;
  summary: string;
  tags: string[];
  aliases: string[];
}

/** 无向概念关系；source 和 target 仅用于稳定标识两端。 */
export interface WikiGraphEdge {
  id: string;
  kind: "directory" | "related";
  source: string;
  target: string;
}

/** 提供给本地页面的完整关系图快照。 */
export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  warnings: string[];
}

/** 根节点使用 Wiki 相对路径，避免与 concepts 中的同名文件冲突。 */
const INDEX_NODE_ID = "wiki/index.md";

/**
 * 从当前 Wiki 快照构造无向关系图。
 *
 * @param wikiDirectory Wiki 根目录，默认取当前工作目录下的 wiki。
 * @returns 可直接由浏览器渲染的节点、边和数据提示。
 * @throws index 缺失或无有效目录、概念目录缺失、无有效概念或标题冲突时抛出错误。
 */
export async function readWikiGraph(
  wikiDirectory = path.resolve(process.cwd(), "wiki"),
): Promise<WikiGraph> {
  const conceptsDirectory = path.join(wikiDirectory, "concepts");
  let entries;
  try {
    entries = await readdir(conceptsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("未找到 wiki/concepts，请先运行 llm-wiki compile。", { cause: error });
    }
    throw error;
  }

  const warnings: string[] = [];
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const pages: ConceptPage[] = [];
  for (const entry of markdownFiles) {
    const result = await readConceptPage(path.join(conceptsDirectory, entry.name), entry.name);
    if (result.page) {
      pages.push(result.page);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }
  if (pages.length === 0) {
    throw new Error("wiki/concepts 中没有有效的概念 Markdown，请先运行 llm-wiki compile。");
  }

  const index = await readIndexEntries(wikiDirectory);
  /** 标准标题优先匹配，别名仅用于无法按标准标题定位的关系。 */
  const pageByName = new Map<string, ConceptPage>();
  for (const page of pages) {
    const name = normalizeConceptName(page.node.title);
    if (!name || pageByName.has(name)) {
      throw new Error(`概念标题冲突或无效：${page.node.title}`);
    }
    pageByName.set(name, page);
  }

  /** 有歧义的别名不绑定到任何节点，以免生成错误连线。 */
  const pageByAlias = new Map<string, ConceptPage>();
  const ambiguousAliases = new Set<string>();
  for (const page of pages) {
    for (const alias of page.node.aliases) {
      const name = normalizeConceptName(alias);
      if (!name || pageByName.has(name) || ambiguousAliases.has(name)) {
        continue;
      }
      const existing = pageByAlias.get(name);
      if (existing && existing !== page) {
        pageByAlias.delete(name);
        ambiguousAliases.add(name);
      } else {
        pageByAlias.set(name, page);
      }
    }
  }

  /** 目录引用按标题优先、别名其次匹配，重复引用只保留第一次。 */
  const indexOrder = new Map<ConceptPage, number>();
  const directoryEdges: WikiGraphEdge[] = [];
  for (const entry of index.entries) {
    const name = normalizeConceptName(entry.title);
    const page = pageByName.get(name) ?? pageByAlias.get(name);
    if (!page) {
      warnings.push(`index 中的「${entry.title}」没有对应概念文件。`);
      continue;
    }
    if (indexOrder.has(page)) {
      continue;
    }
    indexOrder.set(page, directoryEdges.length);
    page.node.summary ||= entry.summary;
    directoryEdges.push({
      id: JSON.stringify(["directory", INDEX_NODE_ID, page.node.id]),
      kind: "directory",
      source: INDEX_NODE_ID,
      target: page.node.id,
    });
  }
  if (directoryEdges.length === 0) {
    throw new Error("wiki/index.md 的目录项均未匹配到有效概念文件。");
  }
  for (const page of pages) {
    if (!indexOrder.has(page)) {
      warnings.push(`概念「${page.node.title}」未列入 index，仍会显示。`);
    }
  }
  pages.sort((left, right) => {
    const leftOrder = indexOrder.get(left) ?? Infinity;
    const rightOrder = indexOrder.get(right) ?? Infinity;
    return leftOrder - rightOrder || left.node.title.localeCompare(right.node.title, "zh-CN");
  });

  const edges = new Map<string, WikiGraphEdge>();
  for (const page of pages) {
    for (const relatedName of page.relatedNames) {
      const name = normalizeConceptName(relatedName);
      const target = pageByName.get(name) ?? pageByAlias.get(name);
      if (!target) {
        warnings.push(`概念「${page.node.title}」引用的「${relatedName}」没有对应概念文件。`);
        continue;
      }
      if (target === page) {
        continue;
      }
      const [source, destination] = [page.node.id, target.node.id].sort();
      const id = JSON.stringify([source, destination]);
      edges.set(id, { id, kind: "related", source, target: destination });
    }
  }

  return {
    nodes: [
      { id: INDEX_NODE_ID, kind: "index", title: index.title, summary: "从目录进入 Wiki 概念关系图。", tags: [], aliases: [] },
      ...pages.map((page) => page.node),
    ],
    edges: [
      ...directoryEdges,
      ...Array.from(edges.values()).sort((left, right) => left.id.localeCompare(right.id)),
    ],
    warnings: Array.from(new Set(warnings)),
  };
}
