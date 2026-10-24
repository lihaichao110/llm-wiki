import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseSourceFile } from "../src/compile/parseSourceFile.ts";
import { extractLocalSpreadsheetContent, importLocalSpreadsheet } from "../src/start/localSpreadsheet.ts";
import { resolveStartInput } from "../src/start/resolveStartInput.ts";
import { runStartImport } from "../src/start/runStartImport.ts";
import { SourceTypeEnum } from "../src/tools/shared.ts";

/** 创建真实 XLSX/XLS 文件字节，确保测试覆盖对应格式的解析器。 */
function createWorkbook(
  bookType: "xlsx" | "biff8",
  sheets: Array<{ name: string; rows: unknown[][]; hidden?: 0 | 1 | 2 }>,
): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  workbook.Workbook = { Sheets: sheets.map((sheet) => ({ Hidden: sheet.hidden ?? 0 })) };
  return XLSX.write(workbook, { type: "buffer", bookType }) as Buffer;
}

test("XLSX 导入可见工作表，保留列位置并转义表格内容", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-xlsx-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const filePath = path.join(root, "销售 报表.XLSX");
    const workbook = XLSX.utils.book_new();
    const first = XLSX.utils.aoa_to_sheet([
      [],
      ["名称", "备注", "占比", "日期"],
      ["甲|乙", "首行\n次行", 0.25, 45292],
      ["丙", "路径\\名称", null, 45293],
    ]);
    first.C3.z = "0%";
    first.D3.z = "yyyy-mm-dd";
    first.D4.z = "yyyy-mm-dd";
    XLSX.utils.book_append_sheet(workbook, first, "数据表");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["内部数据"], ["不应导入"]]), "隐藏表");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "空表");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["项目", "数量"], ["最后一表", 3]]), "汇总");
    workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }, { Hidden: 0 }] };
    await writeFile(filePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer);

    assert.deepEqual(await resolveStartInput(filePath), { kind: "localSpreadsheet", value: filePath });
    assert.equal(await importLocalSpreadsheet(filePath), "written");
    assert.equal(await importLocalSpreadsheet(filePath), "skipped");
    assert.deepEqual(await readdir(path.join(root, "sources")), ["销售-报表.md"]);

    const source = await parseSourceFile(path.join(root, "sources", "销售-报表.md"));
    assert.ok(source);
    assert.equal(source.frontmatter.title, "销售 报表");
    assert.equal(source.frontmatter.source, filePath);
    assert.equal(source.frontmatter.sourceType, SourceTypeEnum.LocalSpreadsheet);
    assert.ok(source.content.indexOf("## 数据表") < source.content.indexOf("## 汇总"));
    assert.match(source.content, /\| 名称 \| 备注 \| 占比 \| 日期 \|/);
    assert.match(source.content, /\| 甲\\\|乙 \| 首行<br>次行 \| 25% \| 2024-01-01 \|/);
    assert.match(source.content, /\| 丙 \| 路径\\\\名称 \|  \| 2024-01-02 \|/);
    assert.doesNotMatch(source.content, /隐藏表|不应导入|空表/);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("XLS 与 XLSX 均参与目录导入，并保留逐文件失败统计", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-xls-folder-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const oldPath = path.join(root, "old.XLS");
    const newPath = path.join(root, "new.xlsx");
    await writeFile(oldPath, createWorkbook("biff8", [{ name: "旧表", rows: [["项目", "值"], ["历史", 7]] }]));
    await writeFile(newPath, createWorkbook("xlsx", [{ name: "新表", rows: [["项目", "值"], ["当前", 9]] }]));
    await writeFile(path.join(root, "broken.xls"), "不是 XLS 文件", "utf8");
    await writeFile(path.join(root, "ignored.csv"), "忽略", "utf8");

    assert.deepEqual(await resolveStartInput(oldPath), { kind: "localSpreadsheet", value: oldPath });
    const summary = await runStartImport(root, 2, true);
    assert.equal(summary.written, 2);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].name, "broken.xls");
    assert.deepEqual((await readdir(path.join(root, "sources"))).sort(), ["new.md", "old.md"]);
    const oldSource = await parseSourceFile(path.join(root, "sources", "old.md"));
    assert.equal(oldSource?.frontmatter.source, oldPath);
    assert.equal(oldSource?.frontmatter.sourceType, SourceTypeEnum.LocalSpreadsheet);
    assert.match(oldSource?.content ?? "", /\| 历史 \| 7 \|/);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("空工作簿、隐藏工作表和损坏文件不会写入 source", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "llm-wiki-empty-sheet-")));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const emptyPath = path.join(root, "empty.xlsx");
    const hiddenPath = path.join(root, "hidden.xlsx");
    const brokenPath = path.join(root, "broken.xlsx");
    await writeFile(emptyPath, createWorkbook("xlsx", [{ name: "空表", rows: [[]] }]));
    await writeFile(hiddenPath, createWorkbook("xlsx", [
      { name: "可见空表", rows: [[]] },
      { name: "隐藏数据", rows: [["秘密"]], hidden: 2 },
    ]));
    await writeFile(brokenPath, "not a zip", "utf8");

    await assert.rejects(importLocalSpreadsheet(emptyPath), /没有可导入的可见单元格/);
    await assert.rejects(importLocalSpreadsheet(hiddenPath), /没有可导入的可见单元格/);
    await assert.rejects(importLocalSpreadsheet(brokenPath), /文件格式无效或文件已损坏/);
    assert.deepEqual(await readdir(path.join(root, "sources")), []);
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("XLS 与 XLSX 的解析结果只使用已有公式值", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["项目", "结果"], ["合计", null]]);
  sheet.B2 = { t: "n", f: "2+3", v: 5 };
  XLSX.utils.book_append_sheet(workbook, sheet, "计算");
  for (const [bookType, extension] of [["xlsx", ".xlsx"], ["biff8", ".xls"]] as const) {
    const data = XLSX.write(workbook, { type: "buffer", bookType }) as Buffer;
    assert.match(extractLocalSpreadsheetContent(data, `计算${extension}`), /\| 合计 \| 5 \|/);
  }
});
