import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { ChunkEmbeddingInfo } from '../src/types/embedding.ts';
import { MAX_CONTEXT_LENGTH, rankWikiEmbeddings, searchWiki } from '../src/query/searchWiki.ts';

/** 创建用于验证排序的向量记录，避免测试依赖网络服务。 */
function record(fileName: string, embedding: number[], text = `${fileName} 的正文`): ChunkEmbeddingInfo {
  return {
    model: 'baai/bge-m3',
    embedding,
    text,
    file_name: fileName,
    section_path: [fileName.replace(/\.md$/, ''), '内容'],
    position: 0,
    start_line: 3,
    end_line: 5,
  };
}

test('查询结果按余弦相似度排序并只保留前六条', () => {
  const results = rankWikiEmbeddings([1, 0], [
    record('第七.md', [-1, 0]),
    record('第四.md', [1, 1]),
    record('第一.md', [1, 0]),
    record('第六.md', [-1, 1]),
    record('第三.md', [2, 1]),
    record('第五.md', [0, 1]),
    record('第二.md', [4, 1]),
  ]);

  assert.deepEqual(results.map((item) => item.fileName), [
    '第一.md', '第二.md', '第三.md', '第四.md', '第五.md', '第六.md',
  ]);
  assert.equal(results[0].score, 1);
  assert.deepEqual(results[0].sectionPath, ['第一', '内容']);
  assert.equal(results[0].startLine, 3);
});

test('忽略维度不符、零向量和非有限数值', () => {
  const results = rankWikiEmbeddings([1, 0], [
    record('维度不符.md', [1]),
    record('零向量.md', [0, 0]),
    record('非法数值.md', [Number.NaN, 0]),
    record('有效.md', [1, 0]),
  ]);

  assert.deepEqual(results.map((item) => item.fileName), ['有效.md']);
});

test('按相似度选取片段，并限制正文总量', () => {
  const results = rankWikiEmbeddings([1, 0], Array.from({ length: 8 }, (_, index) =>
    record(`${index}.md`, [1, index / 100], '内容'.repeat(550))));
  assert.equal(results.length, 5);
  assert.ok(results.reduce((total, item) => total + item.text.length, 0) <= MAX_CONTEXT_LENGTH);
  assert.deepEqual(results.map((item) => item.fileName), ['0.md', '1.md', '2.md', '3.md', '4.md']);
});

test('旧索引在生成问题向量前提示重建', async (context) => {
  const previousCwd = process.cwd();
  const root = await mkdtemp(path.join(previousCwd, '.search-test-'));
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('不应请求向量接口'); });
  try {
    process.chdir(root);
    await mkdir(path.join(root, '.llmwiki'));
    await writeFile(path.join(root, '.llmwiki', 'embedding.json'), '[]', 'utf8');
    await assert.rejects(searchWiki('问题'), /旧版整篇格式.*llm-wiki vector/);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test('v2 索引能检索到具体片段及原文件位置', async (context) => {
  const previousCwd = process.cwd();
  const previousToken = process.env.OPENROUTER_API_KEY;
  const root = await mkdtemp(path.join(previousCwd, '.search-test-'));
  process.env.OPENROUTER_API_KEY = 'test-key';
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    model: 'baai/bge-m3', object: 'list',
    data: [{ object: 'embedding', index: 0, embedding: [1, 0] }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    process.chdir(root);
    await mkdir(path.join(root, '.llmwiki'));
    await writeFile(path.join(root, '.llmwiki', 'embedding.json'), JSON.stringify({
      version: 2,
      embeddings: [record('概念.md', [1, 0], '目标段落'), record('其他.md', [0, 1], '无关段落')],
    }), 'utf8');
    const results = await searchWiki('目标是什么？');
    assert.equal(results[0].text, '目标段落');
    assert.equal(results[0].fileName, '概念.md');
    assert.deepEqual(results[0].sectionPath, ['概念', '内容']);
    assert.deepEqual([results[0].position, results[0].startLine, results[0].endLine], [0, 3, 5]);
  } finally {
    process.chdir(previousCwd);
    if (previousToken === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});
