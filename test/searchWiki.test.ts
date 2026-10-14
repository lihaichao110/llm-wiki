import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmbeddingInfo } from '../src/types/embedding.ts';
import { rankWikiEmbeddings } from '../src/query/searchWiki.ts';

/** 创建用于验证排序的向量记录，避免测试依赖网络服务。 */
function record(fileName: string, embedding: number[]): EmbeddingInfo {
  return {
    model: 'baai/bge-m3',
    embedding,
    text: `${fileName} 的正文`,
    file_name: fileName,
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
