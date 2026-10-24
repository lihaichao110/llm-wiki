import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { LOCAL_INPUT_KINDS, type LocalFileInputKind } from "@/start/resolveStartInput";

/** 目录扫描结果；不支持的普通文件和链接也保留为可显示的跳过任务。 */
export interface LocalInputEntry {
  path: string;
  displayName: string;
  kind: LocalFileInputKind | "skip";
  skipReason?: string;
}

/**
 * 递归枚举本地目录，按相对路径排序并排除当前项目的输出目录。
 *
 * @param rootDirectory 已解析为真实路径的输入目录。
 * @returns 文件与符号链接的任务清单。
 * @throws 目录无法读取时透传文件系统异常。
 */
export async function collectLocalInputs(rootDirectory: string): Promise<LocalInputEntry[]> {
  /** 输出目录可能位于输入树内，扫描时排除它以免导入既有 source。 */
  const outputDirectory = path.join(await realpath(process.cwd()), "sources");
  if (rootDirectory === outputDirectory || rootDirectory.startsWith(`${outputDirectory}${path.sep}`)) {
    return [];
  }

  const inputs: LocalInputEntry[] = [];

  /** 遍历实体目录，不跟随目录内的符号链接。 */
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entryPath === outputDirectory) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      const displayName = path.relative(rootDirectory, entryPath);
      if (entry.isSymbolicLink()) {
        inputs.push({ path: entryPath, displayName, kind: "skip", skipReason: "符号链接" });
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const kind = LOCAL_INPUT_KINDS[extension];
      if (!entry.isFile() || !kind) {
        inputs.push({ path: entryPath, displayName, kind: "skip", skipReason: "格式不支持" });
        continue;
      }

      inputs.push({
        path: entryPath,
        displayName,
        kind,
      });
    }
  };

  await visit(rootDirectory);
  return inputs.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
