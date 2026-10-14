import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbedding } from '../src/vector/createEmbedding.ts';

test('通过 OpenRouter 向量接口生成并按输入顺序保存向量', async (context) => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  context.after(() => {
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  });
  const requests: unknown[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = await new Request(input, init).json() as { input: string };
    requests.push(requestBody);
    return new Response(JSON.stringify({
      id: 'response-id',
      model: 'parasail-bge-m3',
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: requestBody.input === '第一段' ? [1, 0] : [0, 1] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const records = await createEmbedding(['第一段', '第二段'], '概念.md');

  assert.deepEqual(requests, [
    { model: 'baai/bge-m3', input: '第一段', encoding_format: 'float' },
    { model: 'baai/bge-m3', input: '第二段', encoding_format: 'float' },
  ]);
  assert.deepEqual(records.map((item) => item.embedding), [[1, 0], [0, 1]]);
  assert.deepEqual(records.map((item) => item.text), ['第一段', '第二段']);
  assert.ok(records.every((item) => item.file_name === '概念.md' && item.model === 'parasail-bge-m3'));
});

test('拒绝缺少有效浮点向量的响应', async (context) => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  context.after(() => {
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  });
  /** 逐项替换模拟响应，以复用同一个 SDK 请求桩验证无效向量。 */
  let data: unknown[] = [];
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    model: 'parasail-bge-m3',
    object: 'list',
    data,
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  // SDK 允许 base64 字符串；索引和检索只接受非空浮点数组。
  for (const invalidData of [
    [{ object: 'embedding', embedding: 'invalid-base64' }],
    [{ object: 'embedding', embedding: [] }],
    [],
  ]) {
    data = invalidData;
    await assert.rejects(createEmbedding('问题', '[query]'), /未返回有效的浮点向量/);
  }
});
