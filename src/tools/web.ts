import ora from "ora";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import chalk from "chalk";
import { convertHtmlToMarkdown } from "@/utils/convertHtmlToMarkdown";
import { writeMarkdownFile } from "@/utils/writeMarkdownFile";
import { SourceTypeEnum } from "./shared";
import { normalizeConceptName } from "@/utils/name";

/**
 * 抓取网页正文并保存为可编译的 Markdown source。
 *
 * @param url 网页的 HTTP(S) 地址。
 * @returns 写入完成后无返回值。
 * @throws 网络、正文解析或文件写入失败时抛出错误。
 */
export const webTool = async (url: string): Promise<void> => {
  const spinner = ora(`🔍 正在抓取网页：${url}`).start();
  try {
    // fetch拿到原始HTML
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`抓取网页失败：${response.status} ${response.statusText}`);
    }
    const htmlBuffer = Buffer.from(await response.arrayBuffer());

    // SDOM构造DOM，**一定要传入url参数**，用来把页面内相对图片/链接转绝对地址
    const dom = new JSDOM(htmlBuffer, { url });
    const document = dom.window.document;

    // Readability解析DOM，提取正文
    const article = new Readability(document).parse();

    if (!article?.content) {
      throw new Error("无法识别文章内容（不是文章页）");
    }
    console.log(chalk.gray("标题："), chalk.bold(article.title));
    console.log(chalk.gray("来源："), url ?? chalk.gray("未知"));
    console.log(chalk.gray("发布时间："), article.publishedTime ?? chalk.gray("未知"));
    console.log(chalk.gray("文本长度："), `${article.length} 字符`);

    // ========== 核心：Readability 的干净HTML → Markdown ==========
    const markdown = convertHtmlToMarkdown(article.content);
    const title = normalizeConceptName(article.title ?? '') || '未知标题';
    await writeMarkdownFile(title, markdown, {
      directory: 'sources',
      frontmatter: {
        title: title,
        source: url,
        publishedDate: article.publishedTime ?? '',
        sourceType: SourceTypeEnum.Web
      }
    });
    spinner.succeed(chalk.green("✅ 页面抓取成功"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`❌ 页面抓取失败：${message}`));
    throw error;
  } finally {
    spinner.stop();
  }
};
