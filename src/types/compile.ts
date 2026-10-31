export interface CompileOptions {
  /** 并发编译数 */
  concurrency: number;
  /** 忽略上次成功缓存，重新提取与合并全部资料。 */
  force: boolean;
}


/** 批量提取概念时使用的运行参数。 */
export interface ExtractAllConceptsOptions {
  /** 同时执行的模型请求数量。 */
  concurrency: number;

  /** 执行概念提取时使用的模型。 */
  modelId: string;

  /** 本轮编译时间；未指定时使用函数调用时的当前时间。 */
  extractedAt?: string;

  /** 设置后以相对于该目录的路径记录来源，避免子目录同名文件混淆。 */
  sourcesDirectory?: string;
}
