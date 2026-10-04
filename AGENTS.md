# 仓库贡献指南

## 构建、测试与开发命令

- `npm ci`：根据 `package-lock.json` 安装确定版本的依赖。
- `npm run dev`：以监听模式运行 `tsup`，源码变更后自动重新构建。
- `npm run build`：清理并将 `src/index.ts` 打包为 `dist/` 下的 ESM 文件。
- `npx tsc --noEmit`：执行严格的 TypeScript 类型检查，不生成文件。
- `node dist/index.js start <url>`：使用指定网页地址手动验证构建后的 CLI。

如果仓库中存在 `.nvmrc`，执行 Node.js 或前端相关命令前必须先运行 `nvm use`。

## 编码风格与注释规范

使用严格 TypeScript、ES 模块、两空格缩进和分号。函数及变量使用 `camelCase`，类型及接口使用 `PascalCase`，模块级常量使用 `UPPER_SNAKE_CASE`。引用 `src/` 内模块时优先使用 `@/*` 路径别名。

所有关键函数都必须添加 JSDoc，说明函数用途、参数、返回值，以及重要异常或副作用。导出函数和包含非简单业务逻辑的内部函数均视为关键函数。重要变量与常量也必须添加简洁注释，说明其用途、存在原因、单位或取值限制。注释应解释设计意图，不要简单复述代码；修改行为时必须同步更新注释。

```ts
/** 抓取指定网页，并返回转换后的 Markdown 内容。 */
const fetchArticle = async (url: string): Promise<string> => { /* ... */ };

/** 单次请求允许跟随的最大重定向次数。 */
const MAX_REDIRECTS = 5;
```
