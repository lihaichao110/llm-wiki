import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { convertHtmlToMarkdown } from "@/utils/convertHtmlToMarkdown";
import { processNamedSource, type ImportResult } from "@/start/processNamedSource";
import { SourceTypeEnum } from "./shared";
import { normalizeConceptName } from "@/utils/name";

/**
 * 抓取网页正文并保存为可编译的 Markdown source。
 *
 * @param url 网页的 HTTP(S) 地址。
 * @returns 写入或因同名跳过的结果。
 * @throws 网络、正文解析或文件写入失败时抛出错误。
 */
export const webTool = async (url: string): Promise<ImportResult> => {
  // 必须先抓取并解析页面，才能取得用于判重的文章标题。
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`抓取网页失败：${response.status} ${response.statusText}`);
  }
  const htmlBuffer = Buffer.from(await response.arrayBuffer());

  // 提供 URL 以便解析正文中的相对链接和图片地址。
  const dom = new JSDOM(htmlBuffer, { url });
  const document = dom.window.document;

  const article = new Readability(document).parse();

  const articleContent = article?.content;
  if (!articleContent) {
    throw new Error("无法识别文章内容（不是文章页）");
  }
  const title = normalizeConceptName(article.title ?? "") || "未知标题";
  return processNamedSource(title, () => convertHtmlToMarkdown(articleContent), {
    title,
    source: url,
    publishedDate: article.publishedTime ?? "",
    sourceType: SourceTypeEnum.Web,
  });
};
