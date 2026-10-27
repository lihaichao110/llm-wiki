import { startViewServer } from "@/view/server";
import chalk from "chalk";
import { program } from "commander";
import open from "open";

/**
 * 启动本地关系图并尝试在默认浏览器中打开。
 *
 * @returns 服务完成启动后结束；HTTP 服务持续运行直到用户中断。
 */
async function runView(): Promise<void> {
  try {
    const view = await startViewServer();
    console.log(chalk.green(`概念关系图已启动：${view.url}`));
    console.log(chalk.gray("按 Ctrl+C 结束查看。"));

    /** SIGINT/SIGTERM 均关闭监听端口，使进程自然退出。 */
    const shutdown = (): void => {
      void view.close().catch((error: unknown) => {
        console.error(chalk.red(`关闭查看服务失败：${error instanceof Error ? error.message : String(error)}`));
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    try {
      await open(view.url);
    } catch (error) {
      console.warn(chalk.yellow(
        `无法自动打开浏览器，请手动访问 ${view.url}（${error instanceof Error ? error.message : String(error)}）`,
      ));
    }
  } catch (error) {
    console.error(chalk.red(`无法启动关系图：${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
  }
}

program
  .command("view")
  .description("在浏览器中查看 Wiki 概念关系图")
  .action(runView);
