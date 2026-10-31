import initializeVectorStorage from '@/vector';
import { program } from 'commander';

program
  .command('vector')
  .description('初始化 Wiki 向量数据存储目录')
  .action(async () => { await initializeVectorStorage(); });
