import { writeMarkdownFile } from "@/utils/writeMarkdownFile";
import chalk from "chalk";
import { SourceTypeEnum, titleFromFilename } from "./shared";
import ora from "ora";

/**
 * 从 PDF 元数据提取标题，否则从地址的文件名生成标题。
 *
 * @param filePath PDF 的地址。
 * @param info PDF 元数据。
 * @returns 可用于 source 的标题。
 */
export function resolveTitle(filePath: string, info: unknown): string {
  if (info && typeof info === "object") {
    const titleField = (info as Record<string, unknown>)["Title"];
    if (typeof titleField === "string" && titleField.trim().length > 0) {
      return titleField.trim();
    }
  }
  return titleFromFilename(filePath);
}

/**
 * 抓取在线 PDF 内容并保存为可编译的 Markdown source。
 *
 * @param url 在线 PDF 的 HTTP(S) 地址。
 * @returns 写入完成后无返回值。
 * @throws 下载、解析或文件写入失败时抛出错误。
 */
export const pdfTool = async (url: string): Promise<void> => {
  const { PDFParse } = await import("pdf-parse");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 PDF 失败：${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  const spinner = ora(`🔍 正在抓取 PDF 内容：${url}`).start();

  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const title = resolveTitle(url, infoResult.info) || "未知标题";
    await writeMarkdownFile(title, textResult.text?.trim() ?? "", {
      directory: "sources",
      frontmatter: {
        title,
        source: url,
        publishedDate: infoResult.info?.CreationDate,
        sourceType: SourceTypeEnum.OnlinePdf,
      },
    });
    spinner.succeed("✅ PDF 内容抓取成功");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`❌ PDF 处理失败：${message}`));
    throw error;
  } finally {
    parser.destroy();
    spinner.stop();
  }
};
