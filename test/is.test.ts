import assert from "node:assert/strict";
import test from "node:test";
import { isPdfUrl } from "../src/utils/is.ts";

test("识别以 PDF 后缀结尾的在线地址", () => {
  assert.equal(isPdfUrl("https://example.com/files/report.pdf"), true);
  assert.equal(isPdfUrl("http://example.com/files/report.PDF"), true);
});

test("识别相对路径和绝对路径中的 PDF 文件", () => {
  assert.equal(isPdfUrl("./files/report.pdf"), true);
  assert.equal(isPdfUrl("/Users/example/files/report.pdf"), true);
  assert.equal(isPdfUrl("C:\\files\\report.pdf"), true);
});

test("判断 PDF 后缀时忽略查询参数和锚点", () => {
  assert.equal(isPdfUrl("https://example.com/report.pdf?download=1#page=2"), true);
  assert.equal(isPdfUrl("./files/report.pdf#page=2"), true);
});

test("拒绝非 PDF 后缀的地址", () => {
  assert.equal(isPdfUrl("https://example.com/report.pdf.html"), false);
  assert.equal(isPdfUrl("/files/report.txt"), false);
  assert.equal(isPdfUrl(""), false);
});
