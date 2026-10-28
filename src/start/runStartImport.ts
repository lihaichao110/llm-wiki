import { collectLocalInputs } from "@/start/collectLocalInputs";
import { importLocalMarkdown, importLocalText } from "@/start/localText";
import { importLocalPdf } from "@/start/localPdf";
import { importLocalSpreadsheet } from "@/start/localSpreadsheet";
import { resolveStartInput, type StartInputKind } from "@/start/resolveStartInput";
import type { ImportResult } from "@/start/processNamedSource";
import { pdfTool } from "@/tools/pdf";
import { webTool } from "@/tools/web";
import { Listr } from "listr2";

/** 单个任务的输入；目录中的不可导入项保留跳过原因。 */
interface StartJob {
  path: string;
  displayName: string;
  kind: Exclude<StartInputKind, "localDirectory"> | "skip";
  skipReason?: string;
}

/** start 命令结束后的统计与失败详情。 */
export interface StartImportSummary {
  written: number;
  skipped: number;
  errors: Array<{ name: string; message: string }>;
}

/** 各可导入输入类型的处理器，统一返回写入或跳过结果。 */
const INPUT_HANDLERS: Record<Exclude<StartInputKind, "localDirectory">, (value: string) => Promise<ImportResult>> = {
  web: webTool,
  onlinePdf: pdfTool,
  localPdf: importLocalPdf,
  localText: importLocalText,
  localMarkdown: importLocalMarkdown,
  localSpreadsheet: importLocalSpreadsheet,
};

/**
 * 展开输入为 Listr2 的逐文件任务，保留目录中的不支持项以显示跳过状态。
 *
 * @param input 命令行传入的 URL 或本地路径。
 * @returns 按相对路径排序的任务清单。
 * @throws 输入无效或目录无法读取时透传错误。
 */
async function resolveStartJobs(input: string): Promise<StartJob[]> {
  const resolved = await resolveStartInput(input);
  if (resolved.kind === "localDirectory") {
    return collectLocalInputs(resolved.value);
  }
  return [{
    path: resolved.value,
    displayName: resolved.displayName,
    kind: resolved.kind,
  }];
}

/**
 * 用 Listr2 并发导入输入并汇总全部任务的结果。
 *
 * @param input URL、本地文件或文件夹路径。
 * @param concurrency 同时执行的任务数量。
 * @param silent 测试时关闭终端渲染，业务行为保持一致。
 * @returns 成功、跳过和失败统计。
 * @throws 输入或目录扫描失败时透传错误。
 */
export async function runStartImport(
  input: string,
  concurrency: number,
  silent = false,
): Promise<StartImportSummary> {
  const jobs = await resolveStartJobs(input);
  const summary: StartImportSummary = { written: 0, skipped: 0, errors: [] };
  if (jobs.length === 0) {
    return summary;
  }

  const tasks = new Listr(
    jobs.map((job) => ({
      title: `${job.displayName}  等待中`,
      task: async (_context: unknown, task): Promise<void> => {
        if (job.kind === "skip") {
          summary.skipped += 1;
          task.skip(`${job.displayName}  已跳过：${job.skipReason}`);
          return;
        }

        task.title = `${job.displayName}  正在处理`;
        try {
          const result = await INPUT_HANDLERS[job.kind](job.path);
          if (result === "skipped") {
            summary.skipped += 1;
            task.skip(`${job.displayName}  已跳过：同名文件已存在`);
          } else {
            summary.written += 1;
            task.title = `${job.displayName}  处理完成`;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          summary.errors.push({ name: job.displayName, message });
          task.title = `${job.displayName}  处理失败`;
          throw error;
        }
      },
    })),
    {
      concurrent: concurrency,
      exitOnError: false,
      collectErrors: true,
      renderer: silent ? "silent" : "default",
      rendererOptions: { showSkipMessage: true, collapseSkips: true, showErrorMessage: false },
    },
  );

  await tasks.run();
  return summary;
}
