import { resolveStartInput, type StartInputKind } from "@/start/resolveStartInput";
import { importLocalMarkdown, importLocalText } from "@/start/localText";
import { pdfTool } from "@/tools/pdf";
import { webTool } from "@/tools/web";
import chalk from "chalk";
import { program } from "commander";
import ora from 'ora'

/** 各输入类型对应的处理器；新增格式时只需扩展识别规则和此映射。 */
const INPUT_HANDLERS: Record<StartInputKind, (value: string) => Promise<void>> = {
  web: webTool,
  onlinePdf: pdfTool,
  localText: importLocalText,
  localMarkdown: importLocalMarkdown,
};

program
  .command("start")
  .description("导入网页、在线 PDF 或本地 TXT/Markdown 文件")
  .argument("<input>", "HTTP(S) 地址或本地文件路径")
  .action(async (input: string) => {
    let spinner = null
    try {

      spinner = ora(chalk.blue(`开始处理任务: ${input}`)).start()
      const resolvedInput = await resolveStartInput(input);
      await INPUT_HANDLERS[resolvedInput.kind](resolvedInput.value);
      spinner.succeed('✅ 处理成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`❌ 处理失败：${message}`));
      process.exitCode = 1;
    } finally {
      spinner?.stop()
    }
  });
