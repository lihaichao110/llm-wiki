import { processNamedSource, type ImportResult } from "@/start/processNamedSource";
import { SourceTypeEnum } from "@/tools/shared";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

/** XLSX 使用 ZIP 容器；校验文件头可防止文本文件被误识别为表格。 */
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Excel 97-2003 XLS 使用 OLE 容器，较早的 XLS 也可能直接存储 BIFF 记录。 */
const XLS_OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * 检查工作簿的基本文件头，避免 SheetJS 将损坏的文件回退为纯文本表格。
 *
 * @param data 原文件字节。
 * @param filePath 原文件路径，用于确定预期格式并生成错误信息。
 * @throws 文件头与 XLSX/XLS 格式不符时抛出错误。
 */
function validateWorkbookSignature(data: Buffer, filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xlsx") {
    if (!data.subarray(0, XLSX_SIGNATURE.length).equals(XLSX_SIGNATURE)) {
      throw new Error(`XLSX 文件格式无效或文件已损坏：${filePath}`);
    }
    return;
  }

  /** 旧版 XLS 可能以 BIFF BOF 记录开头，也可能是 XML SpreadsheetML。 */
  const hasOleHeader = data.subarray(0, XLS_OLE_SIGNATURE.length).equals(XLS_OLE_SIGNATURE);
  const hasBiffHeader = data[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(data[1]);
  const textPrefix = data.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  const hasSpreadsheetXmlHeader = textPrefix.startsWith("<?xml") || textPrefix.startsWith("<Workbook");
  if (!hasOleHeader && !hasBiffHeader && !hasSpreadsheetXmlHeader) {
    throw new Error(`XLS 文件格式无效或文件已损坏：${filePath}`);
  }
}

/**
 * 转义会改变 Markdown 表格结构的字符，保留单元格原有的显示文本。
 *
 * @param value SheetJS 返回的格式化单元格值。
 * @returns 可安全放入 Markdown 表格单元格的文本。
 */
function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * 将一个工作表的非空行写成 Markdown 表格，首个非空行作为表头。
 *
 * @param sheet 工作表数据。
 * @returns 表格正文；没有可显示单元格时返回空字符串。
 */
function renderWorksheet(sheet: XLSX.WorkSheet): string {
  /** raw:false 使用 Excel 保存的格式化显示值，而不把日期和百分比写成原始数字。 */
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }).filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
  if (rows.length === 0) {
    return "";
  }

  /** 按工作表中最宽的非空行补齐空列，避免数据行与表头错位。 */
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const renderRow = (row: unknown[]): string =>
    `| ${Array.from({ length: columnCount }, (_, index) => escapeMarkdownCell(row[index])).join(" | ")} |`;

  return [
    renderRow(rows[0]),
    `| ${Array(columnCount).fill("---").join(" | ")} |`,
    ...rows.slice(1).map(renderRow),
  ].join("\n");
}

/**
 * 读取工作簿中可见的工作表，并按原顺序转换为 Markdown。
 *
 * @param data XLSX 或 XLS 原文件字节。
 * @param filePath 原文件路径，用于校验格式和报告错误。
 * @returns 含工作表标题和表格的 Markdown 正文。
 * @throws 文件损坏、加密不受支持或全部可见工作表为空时抛出错误。
 */
export function extractLocalSpreadsheetContent(data: Buffer, filePath: string): string {
  validateWorkbookSignature(data, filePath);
  const workbook = XLSX.read(data, { type: "buffer", cellText: true, cellFormula: false, WTF: true });
  const sections: string[] = [];

  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    if (workbook.Workbook?.Sheets?.[index]?.Hidden) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`工作表无法读取：${sheetName}`);
    }
    const table = renderWorksheet(sheet);
    if (table) {
      /** 工作表名称中换行不应打断 Markdown 标题。 */
      const heading = sheetName.replace(/\r\n|\r|\n/g, " ");
      sections.push(`## ${heading}\n\n${table}`);
    }
  }

  if (sections.length === 0) {
    throw new Error(`工作簿没有可导入的可见单元格：${filePath}`);
  }
  return sections.join("\n\n");
}

/**
 * 将本地 XLSX/XLS 工作簿作为一个 Markdown source 导入。
 *
 * @param filePath 原文件的真实绝对路径。
 * @returns 写入或因同名文件已存在而跳过的结果。
 * @throws 文件读取、解析或 Markdown 写入失败时透传异常。
 */
export async function importLocalSpreadsheet(filePath: string): Promise<ImportResult> {
  const title = path.basename(filePath, path.extname(filePath)).trim();
  if (!title) {
    throw new Error(`无法从文件名生成标题：${filePath}`);
  }

  return processNamedSource(title, async () => {
    const data = await readFile(filePath);
    return extractLocalSpreadsheetContent(data, filePath);
  }, {
    title,
    source: filePath,
    sourceType: SourceTypeEnum.LocalSpreadsheet,
  });
}
