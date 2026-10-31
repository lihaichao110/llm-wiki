import { createProviderFromEnv } from "../src/providers/createProviderFromEnv";
import { generateReleaseNotes } from "./releaseNotes";
import { readReleaseDiff } from "./releaseNotesDiff";

/** CI 独立使用的模型配置，避免与 CLI 运行时配置混淆。 */
const REQUIRED_CONFIG = ["RELEASE_NOTES_MODEL", "RELEASE_NOTES_BASE_URL", "RELEASE_NOTES_API_KEY"] as const;

/**
 * 从目标 tag 的代码差异生成 Release 正文，仅向 stdout 写入最终 Markdown。
 * @throws 缺少配置、Git 差异无效或模型生成失败时抛错。
 */
async function main(): Promise<void> {
  const tag = process.argv[2];
  if (!tag || process.argv.length !== 3) throw new Error("用法：tsx scripts/generateReleaseNotes.ts <v版本号>");
  for (const name of REQUIRED_CONFIG) {
    if (!process.env[name]?.trim()) throw new Error(`缺少发布说明配置：${name}`);
  }
  const diff = readReleaseDiff(tag, process.cwd());
  process.stderr.write(`生成 ${tag} 更新说明：${diff.previousTag ?? "初始版本"} → ${tag}，${diff.changedFiles.length} 个文件。\n`);
  const provider = createProviderFromEnv({
    LLM_MODEL: process.env.RELEASE_NOTES_MODEL,
    LLM_BASE_URL: process.env.RELEASE_NOTES_BASE_URL,
    LLM_API_KEY: process.env.RELEASE_NOTES_API_KEY,
  });
  process.stdout.write(await generateReleaseNotes(diff, provider));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
