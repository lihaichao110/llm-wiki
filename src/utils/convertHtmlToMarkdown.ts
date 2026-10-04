import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** 会导致 GFM 表格结构或单元格换行失真的后代元素名称。 */
const COMPLEX_CELL_CONTENT_NAMES = new Set([
  "ADDRESS",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "DL",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "OL",
  "P",
  "PRE",
  "TABLE",
  "UL",
]);

/**
 * 检查单元格后代是否包含 GFM 表格无法稳定表达的元素。
 * 使用子节点遍历以兼容 Turndown 内部的轻量 DOM 实现。
 *
 * @param cell - 待检查的表格单元格。
 * @returns 是否存在复杂后代元素。
 */
const hasComplexCellContent = (cell: HTMLTableCellElement): boolean => {
  /** 尚未检查的后代元素栈。 */
  const pendingElements = Array.from(cell.children);

  while (pendingElements.length > 0) {
    /** 当前被检查的后代元素。 */
    const element = pendingElements.pop();
    if (!element) {
      continue;
    }
    if (COMPLEX_CELL_CONTENT_NAMES.has(element.nodeName)) {
      return true;
    }
    pendingElements.push(...Array.from(element.children));
  }

  return false;
};

/**
 * 判断表格是否超出 GFM 表格能够稳定表达的结构范围。
 *
 * @param node - Turndown 当前处理的 HTML 元素。
 * @returns 表格是否应保留为原始 HTML。
 */
const isComplexTable = (node: HTMLElement): boolean => {
  if (node.nodeName !== "TABLE") {
    return false;
  }

  /** 当前待检查的表格元素。 */
  const table = node as HTMLTableElement;
  /** 表格内所有单元格，用于检查跨行、跨列与块级内容。 */
  const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("th, td"));

  if (
    cells.some(
      (cell) =>
        cell.colSpan > 1 ||
        cell.rowSpan > 1 ||
        hasComplexCellContent(cell),
    )
  ) {
    return true;
  }

  /** 各行实际占用的列数，用于识别列数不一致的非规则表格。 */
  const columnCounts = Array.from(table.rows, (row) =>
    Array.from(row.cells).reduce((count, cell) => count + cell.colSpan, 0),
  );

  return new Set(columnCounts).size > 1;
};

/**
 * 创建配置完整的 HTML 到 Markdown 转换器。
 *
 * @returns 已启用 GFM，并能为复杂表格降级保留 HTML 的 Turndown 实例。
 */
const createTurndownService = (): TurndownService => {
  /** 负责执行正文 HTML 转换的 Turndown 实例。 */
  const turndownService = new TurndownService({
    headingStyle: "atx",
  });

  turndownService.use(gfm);
  turndownService.addRule("preserveComplexTable", {
    filter: isComplexTable,
    replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
  });

  return turndownService;
};

/** 集中复用转换规则，避免不同网页抓取任务产生不一致的 Markdown。 */
const turndownService = createTurndownService();

/**
 * 将 Readability 提取出的正文 HTML 转换为 Markdown。
 *
 * @param html - 待转换的正文 HTML。
 * @returns 转换完成的 Markdown；复杂表格会以内嵌 HTML 形式保留。
 */
export const convertHtmlToMarkdown = (html: string): string =>
  turndownService.turndown(html);
