import { program } from "commander";
import chalk from "chalk";
import { isHttpUrl, isPdfUrl } from "@/utils/is";
import { webTool } from "@/tools/web";
import { pdfTool } from "@/tools/pdf";

program
  .command('start')
  .description('开始处理任务')
  .argument('<url>', '在线网页地址')
  .action(async (url) => {
    if (isHttpUrl(url)) {
      console.log(chalk.blue(`开始处理任务: ${url}`));
      if (isPdfUrl(url)) {
        pdfTool(url)
        return
      }
      webTool(url);
      return
    }
    console.error(chalk.red('请输入正确的在线网页地址'));
    process.exit(1);
  });
