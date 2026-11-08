/** Markdown 正文中保持原始行号的内容块。 */
export interface MarkdownBlock {
  kind: 'paragraph' | 'list' | 'table' | 'code';
  lines: string[];
  startLine: number;
}

/** 标题路径与该标题下的正文块。 */
export interface MarkdownSection {
  path: string[];
  blocks: MarkdownBlock[];
}

/** 编译器生成的导航章节不包含可独立回答问题的正文。 */
const NAVIGATION_HEADINGS = new Set(['相关概念', '原文证据']);

/**
 * 按标题及空行整理 Markdown 正文，保留每个内容块在文件中的真实行号。
 * @param content 完整概念页 Markdown。
 * @param fileName 概念文件名，页面缺少一级标题时用作标题。
 * @returns 按文件顺序排列的章节；Frontmatter 与纯导航章节已排除。
 */
export function readMarkdownSections(content: string, fileName: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  let firstBodyLine = 0;
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (closing >= 0) firstBodyLine = closing + 1;
  }

  const sections: MarkdownSection[] = [];
  const fallbackTitle = fileName.replace(/\.md$/i, '');
  const headings: { level: number; text: string }[] = [{ level: 1, text: fallbackTitle }];
  let section: MarkdownSection = { path: [fallbackTitle], blocks: [] };
  let block: MarkdownBlock | undefined;
  let fenceMarker: string | undefined;
  let skipLevel = 0;

  /** 在章节或块边界保存非空内容，并过滤纯 Wiki 导航链接。 */
  const flushBlock = (): void => {
    if (!block) return;
    const text = block.lines.join('\n').trim();
    if (text && !/^(?:[-*+]\s+)?\[\[[^\]\n]+\]\](?:\s*\n(?:[-*+]\s+)?\[\[[^\]\n]+\]\])*\s*$/.test(text)) {
      section.blocks.push(block);
    }
    block = undefined;
  };
  /** 只保存含可检索正文的章节。 */
  const flushSection = (): void => {
    flushBlock();
    if (section.blocks.length > 0) sections.push(section);
  };

  for (let index = firstBodyLine; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMarker) {
      block?.lines.push(line);
      if (fence && fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length) {
        fenceMarker = undefined;
        flushBlock();
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushSection();
      const level = heading[1].length;
      const title = heading[2].trim();
      const replaced = headings.findIndex((item) => item.level >= level);
      headings.splice(replaced < 0 ? headings.length : replaced);
      headings.push({ level, text: title });
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && NAVIGATION_HEADINGS.has(title)) skipLevel = level;
      section = { path: headings.map((item) => item.text), blocks: [] };
      continue;
    }
    if (skipLevel || !line.trim()) {
      flushBlock();
      continue;
    }

    const kind: MarkdownBlock['kind'] = fence ? 'code'
      : /^\s*\|.*\|\s*$/.test(line) ? 'table'
        : /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line) ? 'list'
          : block?.kind === 'list' && /^\s{2,}\S/.test(line) ? 'list' : 'paragraph';
    if (block?.kind !== kind) flushBlock();
    block ??= { kind, lines: [], startLine: index + 1 };
    block.lines.push(line);
    if (fence) fenceMarker = fence[1];
  }
  flushSection();
  return sections;
}
