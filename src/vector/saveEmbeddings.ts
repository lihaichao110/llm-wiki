import { randomUUID } from "crypto";
import { mkdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import type { EmbeddingInfo } from "@/types/embedding";

/**
 * 将本次生成的向量记录原子写入 `.llmwiki/embedding.json`。
 *
 * @param embeddings 本次成功生成的向量记录。
 * @param storageDirectory `.llmwiki` 向量数据目录的绝对或相对路径。
 * @returns 写入成功后的 JSON 文件绝对路径。
 * @throws 目录无法创建、JSON 无法写入或临时文件无法替换目标文件时抛出原始错误。
 */
export async function saveEmbeddings(
  embeddings: EmbeddingInfo[],
  storageDirectory: string,
): Promise<string> {
  /** 最终存储位置；临时文件也放在同一目录以保证重命名具备原子性。 */
  const outputPath = path.resolve(storageDirectory, "embedding.json");
  /** 每次写入使用唯一临时文件，避免并行进程互相覆盖未完成的数据。 */
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(outputPath), { recursive: true });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(embeddings, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    // 写入或替换失败时清理临时文件，并保留原始错误和已有 JSON。
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return outputPath;
}
