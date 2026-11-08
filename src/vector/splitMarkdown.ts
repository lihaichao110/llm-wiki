import { readMarkdownSections, type MarkdownBlock } from './markdownSections';

/** 单次向量请求允许的最大文本长度（UTF-16 字符）。 */
export const MAX_CHUNK_LENGTH = 1200;
/** 相邻片段最多重复的正文字符数。 */
const MAX_OVERLAP_LENGTH = 120;

/** 可定位回概念页的单个检索片段。 */
export interface MarkdownChunk {
  text: string;
  sectionPath: string[];
  position: number;
  startLine: number;
  endLine: number;
}

/** 片段拼接前的最小内容单位，行号只覆盖本轮新增正文。 */
interface ContentUnit {
  text: string;
  startLine: number;
  endLine: number;
  table: boolean;
}

/**
 * 将过长文本优先沿句末、换行或空格切开；没有边界时按硬上限切分。
 * @param text 一个段落或列表项。
 * @param startLine 该文本在原文件中的首行。
 * @param limit 内容部分允许的最大长度。
 * @returns 保持原文顺序的单位，每个单位都不超过长度上限。
 */
function splitLongText(text: string, startLine: number, limit: number): ContentUnit[] {
  const units: ContentUnit[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + limit, text.length);
    if (end < text.length) {
      const candidate = text.slice(offset, end);
      const punctuation = Math.max(...[...candidate.matchAll(/[。！？!?；;\.\n]/g)]
        .map((match) => match.index + 1), -1);
      const space = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'));
      if (punctuation >= limit / 2) end = offset + punctuation;
      else if (space >= limit / 2) end = offset + space + 1;
    }
    const raw = text.slice(offset, end);
    const part = raw.trim();
    if (part) {
      const firstCharacter = offset + raw.length - raw.trimStart().length;
      const lastCharacter = offset + raw.trimEnd().length;
      const before = text.slice(0, firstCharacter).split('\n').length - 1;
      const through = text.slice(0, lastCharacter).split('\n').length - 1;
      units.push({ text: part, startLine: startLine + before, endLine: startLine + through, table: false });
    }
    offset = end;
  }
  return units;
}

/**
 * 将表格按完整行切分，并在每段前重复表头；超长单行会明确报错。
 * @param block 原始 Markdown 表格块。
 * @param limit 内容部分允许的最大长度。
 * @param fileName 错误信息中展示的概念文件名。
 * @returns 可以独立理解的表格片段。
 * @throws 表头或单行连同表头超过片段长度上限时抛错。
 */
function splitTable(block: MarkdownBlock, limit: number, fileName: string): ContentUnit[] {
  const [header, divider] = block.lines;
  const hasHeader = Boolean(divider && /^\s*\|?\s*:?-{3,}/.test(divider));
  const prefix = hasHeader ? `${header}\n${divider}` : '';
  if (prefix.length > limit) {
    throw new Error(`${fileName}:${block.startLine} 的表头超过 ${MAX_CHUNK_LENGTH} 字符片段上限。`);
  }
  const rows = hasHeader ? block.lines.slice(2) : block.lines;
  const firstRowLine = block.startLine + (hasHeader ? 2 : 0);
  const units: ContentUnit[] = [];
  let current: string[] = [];
  let currentStart = firstRowLine;
  const flush = (endLine: number): void => {
    if (current.length === 0) return;
    units.push({ text: [prefix, ...current].filter(Boolean).join('\n'),
      startLine: hasHeader ? block.startLine : currentStart, endLine, table: true });
    current = [];
  };
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const line = firstRowLine + index;
    if ([prefix, row].filter(Boolean).join('\n').length > limit) {
      throw new Error(`${fileName}:${line} 的表格行连同表头超过 ${MAX_CHUNK_LENGTH} 字符片段上限。`);
    }
    if ([prefix, ...current, row].filter(Boolean).join('\n').length > limit) flush(line - 1);
    if (current.length === 0) currentStart = line;
    current.push(row);
  }
  flush(firstRowLine + rows.length - 1);
  if (rows.length === 0 && prefix) {
    units.push({ text: prefix, startLine: block.startLine,
      endLine: block.startLine + block.lines.length - 1, table: true });
  }
  return units;
}

/**
 * 只复用上一片段末尾的完整段落或句子，避免上下文从半句话开始。
 * @param previousBody 上一片段正文。
 * @param limit 当前片段为重复上下文留出的字符数。
 * @returns 不超过长度上限的完整上下文；无法取得完整句子时返回空串。
 */
function adjacentContext(previousBody: string, limit: number): string {
  const lastParagraph = previousBody.split('\n\n').at(-1)?.trim() ?? '';
  if (lastParagraph.length <= limit) return lastParagraph;
  const tail = previousBody.slice(-limit);
  const firstBoundary = tail.search(/[。！？!?；;\.\n]/);
  return firstBoundary < 0 ? '' : tail.slice(firstBoundary + 1).trim();
}

/**
 * 按 Markdown 标题、段落和表格生成有界的检索片段。
 * @param content 完整概念页 Markdown。
 * @param fileName 概念文件名，用于无标题页面及错误定位。
 * @returns 按正文顺序排列的片段；位置由文件内容确定。
 * @throws 单个不可拆分的表格行超长或章节标题本身超过上限时抛错。
 */
export function splitMarkdown(content: string, fileName = '概念.md'): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  for (const section of readMarkdownSections(content, fileName)) {
    const prefix = section.path.map((heading, index) => `${'#'.repeat(Math.min(index + 1, 6))} ${heading}`).join('\n');
    const maxBodyLength = MAX_CHUNK_LENGTH - prefix.length - 2;
    if (maxBodyLength < 1) throw new Error(`${fileName} 的章节标题超过 ${MAX_CHUNK_LENGTH} 字符。`);
    let body = '';
    let startLine = 0;
    let endLine = 0;
    let previousBody = '';

    /** 保存正文片段；相邻片段之间的重复文本不计入定位行号。 */
    const flush = (): void => {
      if (!body) return;
      chunks.push({ text: `${prefix}\n\n${body}`, sectionPath: [...section.path],
        position: chunks.length, startLine, endLine });
      previousBody = body;
      body = '';
    };

    for (const block of section.blocks) {
      let units: ContentUnit[];
      if (block.kind === 'table') {
        units = splitTable(block, maxBodyLength, fileName);
      } else if (block.kind === 'list') {
        /** 缩进续行仍属于前一个列表项，切分时不能丢掉该项的语境。 */
        const items: { text: string; startLine: number }[] = [];
        for (const [index, line] of block.lines.entries()) {
          if (/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line) || items.length === 0) {
            items.push({ text: line, startLine: block.startLine + index });
          } else {
            items[items.length - 1].text += `\n${line}`;
          }
        }
        units = items.flatMap((item) => splitLongText(item.text, item.startLine,
          Math.max(1, maxBodyLength - MAX_OVERLAP_LENGTH - 2)));
      } else {
        units = splitLongText(block.lines.join('\n'), block.startLine,
          Math.max(1, maxBodyLength - MAX_OVERLAP_LENGTH - 2));
      }
      for (const unit of units) {
        const separator = body ? '\n\n' : '';
        if (body && body.length + separator.length + unit.text.length > maxBodyLength) flush();
        if (!body) {
          const available = maxBodyLength - unit.text.length - 2;
          const overlap = !unit.table && available > 0
            ? adjacentContext(previousBody, Math.min(MAX_OVERLAP_LENGTH, available)) : '';
          body = overlap ? `${overlap}\n\n${unit.text}` : unit.text;
          startLine = unit.startLine;
        } else {
          body += `${separator}${unit.text}`;
        }
        endLine = unit.endLine;
      }
    }
    flush();
  }
  return chunks;
}
