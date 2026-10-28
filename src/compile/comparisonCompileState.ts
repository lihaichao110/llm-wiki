import { SourceDocument } from "@/types/document";
import path from "node:path";
import { createSourceHash } from "./createSourceHash";

/** 编译成功状态文件路径，相对于执行命令时的工作目录。 */
export const STATE_JSON = ".llmwiki/state.json";

/**
 * 为完整的 source 快照生成状态文件，不继承上轮已删除的资料。
 *
 * @param documents 本轮成功解析并参与编译的全部资料。
 * @param sourcesDirectory 本轮扫描的 sources 目录。
 * @returns 可写入状态文件的 JSON；键为 sources 下的相对路径。
 * @throws 文档路径超出 sources 目录时抛出错误。
 */
export function serializeCompileState(
  documents: readonly SourceDocument[],
  sourcesDirectory = "sources",
): string {
  const sourceRoot = path.resolve(process.cwd(), sourcesDirectory);
  /** 每轮从空对象构建，以便删除旧版 basename 键和已删除资料。 */
  const sources: Record<string, { hash: string }> = {};

  for (const document of documents) {
    const relativePath = path.relative(sourceRoot, path.resolve(document.filePath));
    if (
      !relativePath
      || relativePath === ".."
      || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath)
    ) {
      throw new Error(`source 路径超出 sources 目录：${document.filePath}`);
    }

    const sourceKey = relativePath.split(path.sep).join("/");
    sources[sourceKey] = {
      // Frontmatter 也会影响提取结果，不能只比较正文。
      hash: createSourceHash({
        frontmatter: document.frontmatter,
        content: document.content,
      }),
    };
  }

  return JSON.stringify({ sources });
}
