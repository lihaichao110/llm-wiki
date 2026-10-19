import { processNamedSource, type ImportResult } from "@/start/processNamedSource";
import { SourceTypeEnum, titleFromFilename } from "./shared";

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
 * @returns 写入或因同名跳过的结果。
 * @throws 下载、解析或文件写入失败时抛出错误。
 */
export const pdfTool = async (url: string): Promise<ImportResult> => {
  const { PDFParse } = await import("pdf-parse");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 PDF 失败：${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    const infoResult = await parser.getInfo();
    const title = resolveTitle(url, infoResult.info) || "未知标题";
    return await processNamedSource(title, async () => {
      const textResult = await parser.getText();
      return textResult.text?.trim() ?? "";
    }, {
      title,
      source: url,
      publishedDate: infoResult.info?.CreationDate,
      sourceType: SourceTypeEnum.OnlinePdf,
    });
  } finally {
    parser.destroy();
  }
};
