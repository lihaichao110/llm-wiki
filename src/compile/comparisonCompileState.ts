import { SourceDocument } from "@/types/document";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSourceHash } from "./createSourceHash";
import { extractFilePath } from "@/utils/name";

/** 编译状态文件路径，相对于执行命令时的工作目录。 */
export const STATE_JSON = '.llmwiki/state.json'

/**
 * 读取当前编译状态文件。
 *
 * @returns 状态文件存在时返回其 UTF-8 文本内容，否则返回 `false`。
 * @throws 状态文件存在但无法读取时，抛出文件系统异常。
 */
export function StateFile() {
  return existsSync(STATE_JSON) && readFileSync(STATE_JSON, { encoding: 'utf-8' })
}

/**
 * 比较 source 文档与上次成功编译时保存的哈希，判断是否需要重新编译。
 *
 * @param document 待编译的 source 文档。
 * @returns 文档发生变化或不存在历史状态时返回 `true`。
 * @throws 文档内容未发生变化时抛出跳过编译的提示；状态文件格式无效时抛出解析异常。
 */
export function loadCompileState(document: SourceDocument) {
  try {
    const fileName = extractFilePath(document.filePath)
    const newDocumentHash = createSourceHash({
      fileName,
      content: document.content
    })

    const currentStateFile = StateFile()
    const stateFile = currentStateFile ? JSON.parse(currentStateFile) : {}
    const oldDocumentHash = stateFile.sources?.[fileName]?.hash

    if (newDocumentHash === oldDocumentHash) {
      throw new Error(`${fileName} 文件未发生变化，自动跳过编译`)
    }
    return true
  } catch (error: any) {
    throw error;
  }
}

/**
 * 保存 source 文档的最新哈希，供后续编译判断是否发生变化。
 *
 * 写入时会保留其他 source 文件的状态，并在必要时创建 `.llmwiki` 目录。
 *
 * @param document 已完成编译的 source 文档。
 * @returns 状态文件写入完成后兑现的 Promise。
 * @throws 状态文件格式无效或目录、文件无法写入时抛出异常。
 */
export async function saveCompileState(document: SourceDocument) {
  const fileName = extractFilePath(document.filePath)
  const hash = createSourceHash({
    fileName,
    content: document.content
  })

  const currentStateFile = StateFile()
  const stateFile = currentStateFile ? JSON.parse(currentStateFile) : {}
  /** 合并已有记录，避免更新单个文档时丢失其他 source 的编译状态。 */
  const sources = {
    ...(stateFile?.sources || {}),
    [fileName]: {
      hash
    }
  }

  const stateFileValue = JSON.stringify({ sources })

  /** 确保状态文件的父目录存在。 */
  await mkdir(path.dirname(STATE_JSON), { recursive: true });
  await writeFile(STATE_JSON, stateFileValue, 'utf8')
}
