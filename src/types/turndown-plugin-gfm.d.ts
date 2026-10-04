declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  // turndown-plugin-gfm 未提供官方类型声明，这里为其公开插件补充本地类型。
  export const highlightedCodeBlock: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
  export const gfm: TurndownService.Plugin;
}
