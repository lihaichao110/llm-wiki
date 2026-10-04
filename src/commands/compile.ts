import { extractConceptsFromDocument } from '@/compile/extractConcept';
import { parseSourceFile } from '@/compile/parseSourceFile';
import { readSourceFiles } from '@/compile/readSources';
import { writeConceptFiles } from '@/compile/writeConceptFile';
import { createProviderFromEnv } from '@/providers/createProviderFromEnv';
import chalk from 'chalk';
import { program } from 'commander'
import { basename, relative } from 'node:path';
import ora from 'ora'

program.command('compile').description('将 sources 中的 Markdown 编译为结构化 Wiki').action(async () => {
  const spinner = ora({
    color: 'cyan',
    text: chalk.green("🚀 开始编译 sources..."),
  }).start()

  const sourceFiles = await readSourceFiles('sources');

  if (sourceFiles.length === 0) {
    console.log(chalk.red("sources 目录中没有找到 Markdown 文件。"));
    return;
  }

  console.log(chalk.blueBright(`识别到的可编译文件：\n${sourceFiles.join('\n')}`))
  console.log(chalk.greenBright(`共找到 ${sourceFiles.length} 个 Markdown 文件：`));

  const provider = createProviderFromEnv();

  for (const sourceFile of sourceFiles) {
    const document = await parseSourceFile(sourceFile);
    const displayPath = relative(process.cwd(), sourceFile)
    if (!document) {
      console.log(chalk.redBright(`❌ ${displayPath} 文件处理失败`));
      continue
    }

    // Ora 的 color 只作用于旋转符号，文本颜色需要通过 Chalk 单独设置。
    spinner.text = chalk.cyan(`${displayPath} 开始编译：`)
    const compiledAt = new Date().toISOString();
    const result = await extractConceptsFromDocument(
      document,
      provider,
      {
        sourceFileName: basename(sourceFile),
        modelId: process.env.LLM_MODEL ?? "unknown",
        createdAt: compiledAt,
        updatedAt: compiledAt,
      }
    )

    console.log(
      chalk.green(`${displayPath} 提取到 ${result.concepts.length} 个概念：`),
    );

    writeConceptFiles(result.concepts, result.options)

    for (const concept of result.concepts) {
      console.log(`- ${concept.name}`);
    }
  }

  spinner.succeed(chalk.green("\n✅ 编译完成"))
})
