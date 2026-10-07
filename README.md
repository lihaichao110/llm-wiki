# llm-wiki

`llm-wiki` 是一个将网页和 PDF 转换为 Markdown，并借助 OpenAI 兼容的大语言模型将资料编译为结构化 Wiki 的命令行工具。

## 环境要求

- Node.js 24.15.0 或更高版本。
- 一个 OpenAI 兼容的模型接口。

## 安装

```bash
npm install --global @lihaichao/llm-wiki
```

## 配置

运行编译命令前，设置模型和兼容接口的环境变量：

```bash
export LLM_MODEL="<模型名称>"
export LLM_API_KEY="<API Key>"
export LLM_BASE_URL="<兼容接口地址>"
```

不要将真实的 API Key 写入 README、代码或提交历史。

## 使用

将网页或在线 PDF 转换为 Markdown：

```bash
llm-wiki start https://en.wikipedia.org/wiki/Andrej_Karpathy
llm-wiki start https://bitcoin.org/bitcoin.pdf
```

将 `sources/` 中的 Markdown 资料编译为 `wiki/` 下的结构化内容：

```bash
llm-wiki compile
llm-wiki compile --concurrency 3
```

查看所有可用命令：

```bash
llm-wiki --help
```

## 开发

仓库使用 `.nvmrc` 固定 Node.js 主版本：

```bash
nvm use
npm ci
```

## 发布

首次发布需要在本机登录 npm，并通过二次验证创建公开包：

```bash
npm login
npm publish --access public
git tag v1.0.0
npm run release
```

首次发布后，在 npm 包设置中创建 GitHub Actions Trusted Publisher，配置如下：

- Organization or user：`lihaichao110`
- Repository：`llm-wiki`
- Workflow filename：`publish.yml`
- Allowed actions：允许 `npm publish`

新建的 Trusted Publisher 需要在两天内完成首次自动发布，因此应在准备发布下一个版本时再创建。首次 OIDC 发布成功后，可在 npm 中禁用传统发布 Token。

后续版本由 GitHub Actions 自动发布。日常发布流程为：

```bash
npm version patch # 也可使用 minor 或 major
# npm version prepatch --preid=beta 一个 patch 的 beta 预发版
npm run release
```

| 命令	| 输出版本	| 说明 |
| ---- | ---- | ---- |
| npm version patch	| 1.2.4	正式补丁版本 |
| npm version prepatch --preid=beta |	1.2.4‑beta.0 |	下一个 patch 的 beta 预发版 |
| npm version prerelease	| 1.2.4‑beta.1 |	预发布序号 + 1（迭代 beta）|
| npm version patch |	1.2.4	| beta 测试完成，转正正式版本 |

`vX.Y.Z` 标签会触发类型检查、测试、构建、npm 发布和 GitHub Release 创建。
