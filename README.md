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

运行编译或查询命令前，设置模型和兼容接口的环境变量：

```bash
export LLM_MODEL="<模型名称>"
export LLM_API_KEY="<API Key>"
export LLM_BASE_URL="<兼容接口地址>"
```

运行向量化命令还需要配置 OpenRouter Inference Token：

```bash
export OPENROUTER_API_KEY="<OpenRouter Access Token>"
```

该 Token 需要具备 Inference 权限。向量命令使用 OpenRouter 上的 `baai/bge-m3` 模型。

不要将真实的 API Key 写入 README、代码或提交历史。

## 使用

### 命令一览

| 命令 | 作用 |
| --- | --- |
| `llm-wiki start <url>` | 抓取网页或在线 PDF，并保存为 Markdown。 |
| `llm-wiki compile` | 将 `sources/` 中的 Markdown 资料整理为 `wiki/` 下的 Wiki 内容。 |
| `llm-wiki compile --concurrency <数量>` | 编译资料，并设置同时处理的任务数量。 |
| `llm-wiki vector` | 为 `wiki/concepts/` 中的内容生成向量，保存到 `.llmwiki/embedding.json`。 |
| `llm-wiki query <question>` | 检索向量索引，并根据相关 Wiki 内容生成带来源的回答。 |
| `llm-wiki --help` | 查看命令帮助。 |
| `llm-wiki --version`、`llm-wiki -V` | 查看当前版本。 |

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

为 `wiki/concepts/` 中的 Markdown 文件生成向量，并保存到 `.llmwiki/embedding.json`：

```bash
llm-wiki vector
```

运行前请先生成 `wiki/concepts/` 内容，并配置 `OPENROUTER_API_KEY`。每个文件处理完成后会汇总写入向量记录；没有可处理的 Markdown 文件时会提示并结束。

检索 Wiki 中与问题最相关的内容：

```bash
llm-wiki query "无限乱斗有什么特点？"
```

查询需要先运行 `llm-wiki vector`，并配置 `OPENROUTER_API_KEY` 生成问题向量，以及 `LLM_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL` 等模型接口配置（本地兼容服务可不提供 API Key）。命令最多检索 6 条 Wiki 内容，输出基于这些内容的回答，并在文末列出回答实际引用的文件；资料不足时会明确说明。

查看所有可用命令：

```bash
llm-wiki --help
```

## 开发

仓库使用 `.nvmrc` 固定 Node.js 主版本：

```bash
nvm use
pnpm install --frozen-lockfile
```

安装依赖时会启用 Husky。提交前自动运行 `pnpm run check`（类型检查和单元测试），提交信息由 commitlint 校验。日常提交使用 `type(scope): 中文说明`，例如 `fix(vector): 修复空向量校验`；scope 可以省略。`pnpm version` 生成的纯版本号提交仍然允许。

## 发布

首次发布需要在本机登录 npm，并通过二次验证创建公开包：

```bash
npm login
npm publish --access public
git tag v1.0.0
pnpm run release
```

首次发布后，在 npm 包设置中创建 GitHub Actions Trusted Publisher，配置如下：

- Organization or user：`lihaichao110`
- Repository：`llm-wiki`
- Workflow filename：`publish.yml`
- Allowed actions：允许 `npm publish`

新建的 Trusted Publisher 需要在两天内完成首次自动发布，因此应在准备发布下一个版本时再创建。首次 OIDC 发布成功后，可在 npm 中禁用传统发布 Token。

后续版本由 GitHub Actions 自动发布。日常发布流程为：

```bash
pnpm version patch # 也可使用 minor 或 major
# pnpm version prerelease --preid=beta 一个 patch 的 beta 预发版
pnpm run release
```

也可以在 GitHub Actions 的“发布 npm 包”工作流中点击“Run workflow”，选择 `main` 分支手动发布。工作流会从 `main` 的历史中选取版本号最高的 `v*` tag，并要求它与 `package.json` 的版本一致；随后用 `main` 当前代码发布该版本，并复用这个 tag 创建 GitHub Release，不会新建 tag。若需要 Release 页面上的 tag 也指向本次构建的 commit，请先确保该 tag 已指向 `main` 当前 commit。

| 命令	| 输出版本	| 说明 |
| ---- | ---- | ---- |
| pnpm version patch | 1.2.4 | 正式补丁版本 |
| pnpm version prerelease --preid=beta | 1.2.4‑beta.0 | 下一个 patch 的 beta 预发版 |
| pnpm version prerelease | 1.2.4‑beta.1 | 预发布序号 + 1（迭代 beta）|
| pnpm version patch | 1.2.4 | beta 测试完成，转正正式版本 |

`vX.Y.Z` 标签会触发类型检查、测试、构建、npm 发布和 GitHub Release 创建。
