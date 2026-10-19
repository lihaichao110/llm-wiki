import { runStartImport } from "@/start/runStartImport";
import chalk from "chalk";
import { InvalidArgumentError, program } from "commander";

/**
 * 解析单轮导入允许同时处理的文件数。
 *
 * @param value 命令行传入的并发数。
 * @returns 大于零的安全整数。
 * @throws 输入不是正整数时抛出 Commander 参数错误。
 */
function parseConcurrency(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new InvalidArgumentError("并发数量必须是大于等于 1 的整数");
  }
  return count;
}

program
  .command("start")
  .description("导入网页、在线 PDF、本地 TXT/Markdown 文件或文件夹")
  .argument("<input>", "HTTP(S) 地址、本地文件路径或文件夹路径")
  .option("-c, --concurrency <count>", "同时导入的文件数量", parseConcurrency, 3)
  .action(async (input: string, options: { concurrency: number }) => {
    try {
      const summary = await runStartImport(input, options.concurrency);
      console.log(chalk.green(
        `导入结束：成功 ${summary.written}，跳过 ${summary.skipped}，失败 ${summary.errors.length}`,
      ));
      for (const error of summary.errors) {
        console.error(chalk.red(`- ${error.name}：${error.message}`));
      }
      if (summary.errors.length > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`处理失败：${message}`));
      process.exitCode = 1;
    }
  });
