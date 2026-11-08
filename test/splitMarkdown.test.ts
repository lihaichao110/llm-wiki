import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CHUNK_LENGTH, splitMarkdown } from '../src/vector/splitMarkdown.ts';

test('短文保留标题和真实行号，排除 Frontmatter 与导航章节', () => {
  const markdown = [
    '---', 'title: 示例', 'secret: 不应进入向量', '---', '', '# 示例', '',
    '第一段介绍正文。', '', '## 细节', '', '这里是可检索的细节。', '',
    '- [[仅导航链接]]', '', '## 相关概念', '', '- [[其他概念]]', '',
    '## 原文证据', '', '- [[source.md:1-2]]', '',
  ].join('\n');
  const chunks = splitMarkdown(markdown, '示例.md');
  assert.deepEqual(chunks.map(({ sectionPath, position, startLine, endLine }) =>
    ({ sectionPath, position, startLine, endLine })), [
    { sectionPath: ['示例'], position: 0, startLine: 8, endLine: 8 },
    { sectionPath: ['示例', '细节'], position: 1, startLine: 12, endLine: 12 },
  ]);
  assert.ok(chunks.every((chunk) => !/secret|其他概念|source\.md|仅导航链接/.test(chunk.text)));
  assert.deepEqual(splitMarkdown(markdown, '示例.md'), chunks);
});

test('长段落优先在句末切分并保留相邻上下文', () => {
  const sentence = '这里说明一个需要跨片段理解的知识点。';
  const markdown = `# 长文\n\n${sentence.repeat(180)}`;
  const chunks = splitMarkdown(markdown, '长文.md');
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.text.length <= MAX_CHUNK_LENGTH));
  assert.ok(chunks.every((chunk) => chunk.sectionPath[0] === '长文' && chunk.startLine === 3));
  const overlap = chunks[1].text.split('\n\n')[1];
  assert.ok(overlap.length > 0 && overlap.length <= 120);
  assert.ok(chunks[0].text.endsWith(overlap));
  assert.ok(chunks[0].text.trimEnd().endsWith('。'));
});

test('跨行长段落切分后，行号仍指向实际新增正文', () => {
  const markdown = ['# 多行', '', '甲。'.repeat(360), '乙。'.repeat(360)].join('\n');
  const chunks = splitMarkdown(markdown, '多行.md');
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].startLine, 3);
  assert.ok(chunks.some((chunk) => chunk.startLine === 4));
  assert.ok(chunks.every((chunk) => chunk.endLine >= chunk.startLine));
});

test('嵌套标题和列表按正文顺序定位，跨章节片段保留各自路径', () => {
  const markdown = [
    '# 概念', '', '## 机制', '', '### 第一阶段', '', '- 首项', '- 次项', '',
    '### 第二阶段', '', '后续说明。', '', '## 结论', '', '最终结论。',
  ].join('\n');
  const chunks = splitMarkdown(markdown, '概念.md');
  assert.deepEqual(chunks.map((item) => item.sectionPath), [
    ['概念', '机制', '第一阶段'], ['概念', '机制', '第二阶段'], ['概念', '结论'],
  ]);
  assert.deepEqual(chunks.map((item) => [item.startLine, item.endLine]), [[7, 8], [12, 12], [16, 16]]);
  assert.match(chunks[0].text, /- 首项\n\n- 次项/);
});

test('缺少一级标题时使用文件名，列表续行跟随所属列表项', () => {
  const markdown = ['## 用法', '', '- 第一个列表项', '  它的补充说明', '- 第二个列表项'].join('\n');
  const chunks = splitMarkdown(markdown, '无主标题.md');
  assert.deepEqual(chunks[0].sectionPath, ['无主标题', '用法']);
  assert.match(chunks[0].text, /- 第一个列表项\n  它的补充说明\n\n- 第二个列表项/);
});

test('长表格重复表头而不拆行，单行过长时指出原文位置', () => {
  const rows = Array.from({ length: 45 }, (_, index) => `| 名称${index} | ${'详情'.repeat(14)} |`);
  const markdown = ['# 记录', '', '| 名称 | 说明 |', '| --- | --- |', ...rows].join('\n');
  const chunks = splitMarkdown(markdown, '记录.md');
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= MAX_CHUNK_LENGTH));
  assert.ok(chunks.every((chunk) => chunk.text.includes('| 名称 | 说明 |\n| --- | --- |')));
  for (const row of rows) assert.equal(chunks.filter((chunk) => chunk.text.includes(row)).length, 1);

  const tooLong = ['# 记录', '', '| 名称 | 说明 |', '| --- | --- |', `| 超长 | ${'字'.repeat(1200)} |`].join('\n');
  assert.throws(() => splitMarkdown(tooLong, '记录.md'), /记录\.md:5 的表格行连同表头超过 1200 字符/);
});
