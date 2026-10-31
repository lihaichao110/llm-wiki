import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import initializeVectorStorage from "../src/vector/index.ts";

test("单个概念向量化失败时旧索引不变，重试成功后一次性替换", async (context) => {
  const previousCwd = process.cwd();
  const previousToken = process.env.OPENROUTER_API_KEY;
  const root = await mkdtemp(path.join(previousCwd, ".vector-test-"));
  try {
    process.chdir(root);
    process.env.OPENROUTER_API_KEY = "test-key";
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true });
    await mkdir(path.join(root, ".llmwiki"), { recursive: true });
    await writeFile(path.join(root, "wiki", "concepts", "a.md"), "正常概念", "utf8");
    await writeFile(path.join(root, "wiki", "concepts", "b.md"), "失败概念", "utf8");
    const indexPath = path.join(root, ".llmwiki", "embedding.json");
    const oldIndex = '[{"file_name":"旧概念.md"}]\n';
    await writeFile(indexPath, oldIndex, "utf8");

    /** 首轮让第二个文件返回空向量；第二轮恢复有效响应。 */
    let failSecond = true;
    context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = await new Request(input, init).json() as { input: string };
      const failed = failSecond && body.input === "失败概念";
      return new Response(JSON.stringify({
        id: "response-id", model: "parasail-bge-m3", object: "list",
        data: failed ? [] : [{ object: "embedding", index: 0, embedding: [1, 0] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await assert.rejects(initializeVectorStorage(), /有 1 个 Markdown 文件向量化失败/);
    assert.equal(await readFile(indexPath, "utf8"), oldIndex);

    failSecond = false;
    assert.deepEqual(await initializeVectorStorage(), { fileCount: 2, embeddingCount: 2 });
    const records = JSON.parse(await readFile(indexPath, "utf8")) as { file_name: string }[];
    assert.deepEqual(records.map((item) => item.file_name), ["a.md", "b.md"]);
  } finally {
    process.chdir(previousCwd);
    if (previousToken === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousToken;
    await rm(root, { recursive: true, force: true });
  }
});
