import { writeMarkdownFile } from '@/utils/writeMarkdownFile'
import chalk from 'chalk'
import { getHeader } from 'pdf-parse/node'
import { SourceTypeEnum, titleFromFilename } from './shared';
import ora from 'ora';

/** Extract the title from PDF metadata or fall back to the filename. */
export function resolveTitle(filePath: string, info: unknown): string {
  if (info && typeof info === "object") {
    const titleField = (info as Record<string, unknown>)["Title"];
    if (typeof titleField === "string" && titleField.trim().length > 0) {
      return titleField.trim();
    }
  }
  return titleFromFilename(filePath);
}

export const pdfTool = async (url: string) => {
  const { PDFParse } = await import('pdf-parse')

  const response = await fetch(url)
  if (!response.ok) {
    console.log(chalk.red(`❌ 下载 PDF 失败：${response.status} ${response.statusText}`))
    return
  }
  const spinner = ora(`🔍 正在抓取 PDF 内容：${url}`).start();

  const buffer = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data: buffer });

  try {
    const header = await getHeader(url, true);
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const title = resolveTitle(url, infoResult.info)
    writeMarkdownFile(title || '未知标题', textResult.text?.trim(), {
      directory: 'sources',
      frontmatter: {
        title,
        source: url,
        publishedDate: infoResult.info?.CreationDate,
        sourceType: SourceTypeEnum.OnlinePdf
      }
    })
    spinner.succeed('✅ PDF 内容抓取成功')
  } finally {
    parser.destroy();
    spinner.stop()
  }
}