import { processNamedSource, type ImportResult } from "@/start/processNamedSource";
import { resolveTitle } from "@/tools/pdf";
import { SourceTypeEnum } from "@/tools/shared";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** 扫描页按两倍 PDF 原始尺寸渲染，提高中英文 OCR 的识别率。 */
const OCR_RENDER_SCALE = 2;
/** OCR 使用的语言模型，兼顾简体中文及混排英文。 */
const OCR_LANGUAGES = ["chi_sim", "eng"];

/** PDF 解析器在逐页提取与渲染时需要的最小接口。 */
interface PdfPageReader {
  getText(): Promise<{ pages: Array<{ num: number; text: string }> }>;
  getScreenshot(options: {
    partial: number[];
    scale: number;
    imageBuffer: boolean;
    imageDataUrl: boolean;
  }): Promise<{ pages: Array<{ pageNumber: number; data: Uint8Array }> }>;
}

/** 只暴露 OCR 流程使用的方法，以便测试无需下载语言模型。 */
interface OcrWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

/**
 * 在用户缓存目录创建中英文 OCR worker，避免语言模型写入当前项目。
 *
 * @returns 已加载语言模型的 worker；首次使用可能下载模型。
 * @throws 缓存目录创建或语言模型加载失败时透传异常。
 */
async function createLocalOcrWorker(): Promise<OcrWorker> {
  const { createWorker } = await import("tesseract.js");
  /** 只接受绝对缓存路径，防止错误配置把语言模型写入当前项目。 */
  const configuredCacheRoot = process.env.XDG_CACHE_HOME
    || (process.platform === "win32" ? process.env.LOCALAPPDATA : undefined);
  const cacheRoot = configuredCacheRoot && path.isAbsolute(configuredCacheRoot)
    ? configuredCacheRoot
    : path.join(homedir(), ".cache");
  const cachePath = path.join(cacheRoot, "llm-wiki", "ocr");
  await mkdir(cachePath, { recursive: true });
  return createWorker(OCR_LANGUAGES, undefined, { cachePath });
}

/**
 * 保留 PDF 每页原生文字，并仅对无文字页执行 OCR。
 *
 * @param parser 已加载本地 PDF 的解析器。
 * @param createWorker 首次遇到扫描页时创建 OCR worker 的工厂。
 * @returns 按页序拼接并去除首尾空白的正文。
 * @throws PDF 渲染或 OCR 失败时透传异常，并释放已创建的 worker。
 */
export async function extractLocalPdfText(
  parser: PdfPageReader,
  createWorker: () => Promise<OcrWorker> = createLocalOcrWorker,
): Promise<string> {
  const textResult = await parser.getText();
  const pageContents: string[] = [];
  let worker: OcrWorker | undefined;

  try {
    for (const page of textResult.pages) {
      const extractedText = page.text.trim();
      if (extractedText) {
        pageContents.push(extractedText);
        continue;
      }

      // 按需逐页渲染，避免同时持有整份扫描件的高分辨率图片。
      const screenshot = await parser.getScreenshot({
        partial: [page.num],
        scale: OCR_RENDER_SCALE,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const image = screenshot.pages.find((item) => item.pageNumber === page.num)?.data;
      if (!image?.length) {
        throw new Error(`PDF 第 ${page.num} 页渲染失败，无法执行 OCR`);
      }

      worker ??= await createWorker();
      const result = await worker.recognize(Buffer.from(image));
      pageContents.push(result.data.text.trim());
    }
  } finally {
    await worker?.terminate();
  }

  return pageContents.filter(Boolean).join("\n\n").trim();
}

/**
 * 导入本地 PDF，并为没有可提取文字的页面补充 OCR 结果。
 *
 * @param filePath 本地 PDF 的真实绝对路径。
 * @param createWorker 创建 OCR worker 的工厂；默认为本地中英文模型。
 * @returns 写入或因同名跳过的结果。
 * @throws PDF 读取、解析、OCR 或 Markdown 写入失败时透传异常。
 */
export async function importLocalPdf(
  filePath: string,
  createWorker: () => Promise<OcrWorker> = createLocalOcrWorker,
): Promise<ImportResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: await readFile(filePath) });

  try {
    const infoResult = await parser.getInfo();
    const title = resolveTitle(filePath, infoResult.info) || "未知标题";
    return await processNamedSource(title, async () => {
      const content = await extractLocalPdfText(parser, createWorker);
      if (!content) {
        throw new Error(`PDF 无法提取正文：${filePath}`);
      }
      return content;
    }, {
      title,
      source: filePath,
      publishedDate: infoResult.info?.CreationDate,
      sourceType: SourceTypeEnum.LocalPdf,
    });
  } finally {
    await parser.destroy();
  }
}
