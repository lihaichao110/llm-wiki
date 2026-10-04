import assert from "node:assert/strict";
import test from "node:test";
import { convertHtmlToMarkdown } from "../src/utils/convertHtmlToMarkdown.ts";

test("复杂信息框保留为原始 HTML", () => {
  const html = `
    <h1>人物介绍</h1>
    <table>
      <tbody>
        <tr><th colspan="2"><p>Andrej Karpathy</p></th></tr>
        <tr><th>Education</th><td><ul><li>Stanford University</li></ul></td></tr>
      </tbody>
    </table>
    <p>正文内容</p>
  `;

  const markdown = convertHtmlToMarkdown(html);

  assert.match(markdown, /<table>/);
  assert.match(markdown, /<th colspan="2"><p>Andrej Karpathy<\/p><\/th>/);
  assert.match(markdown, /<ul><li>Stanford University<\/li><\/ul>/);
  assert.doesNotMatch(markdown, /\| --- \|/);
  assert.match(markdown, /^# 人物介绍/m);
  assert.match(markdown, /正文内容/);
});

test("规则二维表格继续转换为 GFM Markdown", () => {
  const html = `
    <table>
      <thead><tr><th>Name</th><th>Role</th></tr></thead>
      <tbody><tr><td>Andrej</td><td>Researcher</td></tr></tbody>
    </table>
  `;

  const markdown = convertHtmlToMarkdown(html);

  assert.match(markdown, /\| Name \| Role \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| Andrej \| Researcher \|/);
  assert.doesNotMatch(markdown, /<table>/);
});

test("列数不一致的表格保留为原始 HTML", () => {
  const html = `
    <table>
      <thead><tr><th>Name</th></tr></thead>
      <tbody><tr><td>Andrej</td><td>Researcher</td></tr></tbody>
    </table>
  `;

  const markdown = convertHtmlToMarkdown(html);

  assert.match(markdown, /<table>/);
  assert.doesNotMatch(markdown, /\| --- \|/);
});

test("跨行、嵌套表格和单元格换行均触发 HTML 保留", () => {
  const complexRows = [
    '<tr><th rowspan="2">Name</th><td>Andrej</td></tr><tr><td>Karpathy</td></tr>',
    "<tr><th>Name</th><td><table><tr><td>Andrej</td></tr></table></td></tr>",
    "<tr><th>Name</th><td>Andrej<br>Karpathy</td></tr>",
  ];

  for (const rows of complexRows) {
    const markdown = convertHtmlToMarkdown(`<table>${rows}</table>`);

    assert.match(markdown, /<table>/);
  }
});
