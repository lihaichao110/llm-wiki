export interface CompileOptions {
  /** 并发编译数 */
  concurrency: number;
}


/** 批量提取概念时使用的运行参数。 */
export interface ExtractAllConceptsOptions {
  /** 同时执行的模型请求数量。 */
  concurrency: number;

  /** 执行概念提取时使用的模型。 */
  modelId: string;

  /** 本轮编译时间；未指定时使用函数调用时的当前时间。 */
  extractedAt?: string;
}