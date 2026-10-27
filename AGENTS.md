# 仓库贡献指南

## 构建、测试与开发命令

- `pnpm install --frozen-lockfile`：根据 `pnpm-lock.yaml` 安装确定版本的依赖。
- `pnpm run dev`：以监听模式运行 `tsup`，源码变更后自动重新构建。
- `pnpm run build`：清理并将 `src/index.ts` 打包为 `dist/` 下的 ESM 文件。
- `pnpm exec tsc --noEmit`：执行严格的 TypeScript 类型检查，不生成文件。
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

## 文件拆分规范

手写的 `src/**/*.ts` 文件按物理行数计算，注释和空行也计入。文件超过 300 行时必须拆分，拆分后每个文件均不得超过 300 行。测试文件、文档、资料和生成文件不受此限制。

按单一职责提取有明确用途的模块，保持相关逻辑内聚；不要为了凑行数机械切割函数、删除必要注释或创建没有独立职责的文件。拆分时保持现有对外接口与行为，更新引用和 JSDoc，并运行相关类型检查、测试及构建。
