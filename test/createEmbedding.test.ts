import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbedding } from '../src/vector/createEmbedding.ts';

test('通过 OpenRouter 向量接口生成并按输入顺序保存向量', async () => {
  const requests: unknown[] = [];
  const fetchImplementation: typeof fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as { input: string };
    requests.push(requestBody);
    return new Response(JSON.stringify({
      id: 'response-id',
      model: 'parasail-bge-m3',
      data: [{ index: 0, embedding: requestBody.input === '第一段' ? [1, 0] : [0, 1] }],
    }), { status: 200 });
  };

  const records = await createEmbedding(['第一段', '第二段'], '概念.md', {
    apiKey: 'test-key',
    fetchImplementation,
  });

  assert.deepEqual(requests, [
    { model: 'baai/bge-m3', input: '第一段', encoding_format: 'float' },
    { model: 'baai/bge-m3', input: '第二段', encoding_format: 'float' },
  ]);
  assert.deepEqual(records.map((item) => item.embedding), [[1, 0], [0, 1]]);
  assert.deepEqual(records.map((item) => item.text), ['第一段', '第二段']);
  assert.ok(records.every((item) => item.file_name === '概念.md' && item.model === 'parasail-bge-m3'));
});

test('拒绝缺少有效浮点向量的响应', async () => {
  const fetchImplementation: typeof fetch = async () => new Response(JSON.stringify({
    model: 'parasail-bge-m3',
    data: [{ embedding: 'invalid-base64' }],
  }), { status: 200 });

  await assert.rejects(
    createEmbedding('问题', '[query]', { apiKey: 'test-key', fetchImplementation }),
    /未返回有效的浮点向量/,
  );
});
