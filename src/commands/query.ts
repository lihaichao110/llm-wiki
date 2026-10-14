import { createProviderFromEnv } from '@/providers/createProviderFromEnv';
import { answerWikiQuestion } from '@/query/answerWiki';
import { searchWiki } from '@/query/searchWiki';
import chalk from 'chalk';
import { program } from 'commander';
import ora from 'ora';

/**
 * 检索 Wiki、调用大模型回答，并在等待期间显示动态进度、结束后打印经过校验的来源。
 *
 * @param question 用户输入的问题。
 * @returns 输出完成后结束。
 * @throws 问题为空、检索失败、模型请求失败或模型回答无效时抛出错误。
 */
async function runQuery(question: string): Promise<void> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new Error('问题不能为空。');
  }

  /** 检索和模型回答共用一行动态提示，避免阶段切换时留下多余输出。 */
  const spinner = ora('正在查询 Wiki…').start();

  try {
    const results = await searchWiki(normalizedQuestion);
    spinner.stop();
    console.log(chalk.green(`找到 ${results.length} 条相关 Wiki 内容：`));

    const provider = createProviderFromEnv();
    spinner.start('正在思考并生成回答…');
    const { answer, sources } = await answerWikiQuestion(normalizedQuestion, results, provider);
    spinner.stop();
    console.log(answer);

    if (sources.length > 0) {
      console.log('\n来源：');
      for (const fileName of sources) {
        console.log(`- wiki/concepts/${fileName}`);
      }
    }
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

program
  .command('query')
  .description('检索 Wiki 并根据相关内容回答问题')
  .argument('<question>', '要向 Wiki 提出的问题')
  .action(runQuery);
