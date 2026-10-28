import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import path from "node:path";

/** 一份已在目标同级目录完成写入的发布产物。 */
export interface StagedArtifact {
  targetPath: string;
  stagedPath: string;
  kind: "file" | "directory";
}

/**
 * 读取路径类型；不存在时返回 null，其他文件系统错误继续向上抛出。
 */
async function readKind(filePath: string): Promise<"file" | "directory" | null> {
  try {
    const stat = await lstat(filePath);
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    throw new Error(`不支持替换符号链接或特殊文件：${filePath}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * 顺序发布预先生成的文件，并在任何一步失败时逆序恢复原产物。
 *
 * 多个路径无法做到跨路径的系统级原子替换；此处保证正常异常可以回滚。
 * 备份只有在全部新产物安装成功后才会清理。
 *
 * @param artifacts 按概念目录、索引、状态顺序排列的产物。
 * @param move 文件系统改名操作；可用于注入发布阶段的故障测试。
 * @throws 发布或回滚失败时抛出错误；回滚失败的备份会保留以供恢复。
 */
export async function publishSnapshot(
  artifacts: readonly StagedArtifact[],
  move: typeof rename = rename,
): Promise<void> {
  const entries = artifacts.map((artifact) => ({
    ...artifact,
    backupPath: path.join(
      path.dirname(artifact.targetPath),
      `.${path.basename(artifact.targetPath)}.backup-${randomUUID()}`,
    ),
    originalMoved: false,
    installed: false,
  }));

  // 在第一次改名之前检查所有目标，避免目录/符号链接占位导致部分发布。
  for (const entry of entries) {
    const kind = await readKind(entry.targetPath);
    if (kind && kind !== entry.kind) {
      throw new Error(`目标路径类型不符合预期：${entry.targetPath}`);
    }
    if (await readKind(entry.stagedPath) !== entry.kind) {
      throw new Error(`临时产物缺失或类型不符：${entry.stagedPath}`);
    }
  }

  try {
    for (const entry of entries) {
      if (await readKind(entry.targetPath)) {
        await move(entry.targetPath, entry.backupPath);
        entry.originalMoved = true;
      }
      await move(entry.stagedPath, entry.targetPath);
      entry.installed = true;
    }
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installed) {
          await rm(entry.targetPath, { recursive: entry.kind === "directory", force: true });
        }
        if (entry.originalMoved) {
          await move(entry.backupPath, entry.targetPath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error
          ? rollbackError : new Error(String(rollbackError)));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "发布失败，且部分旧产物恢复失败；备份已保留");
    }
    throw error;
  }

  // 清理失败不代表发布失败；保留残余备份比撤销成功的新快照安全。
  await Promise.allSettled(entries.filter((entry) => entry.originalMoved)
    .map((entry) => rm(entry.backupPath, {
      recursive: entry.kind === "directory",
      force: true,
    })));
}
