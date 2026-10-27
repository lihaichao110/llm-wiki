#!/usr/bin/env node

import { createRequire } from 'node:module'
import '@/commands/start'
import '@/commands/compile'
import '@/commands/vector'
import '@/commands/query'
import '@/commands/view'
import { program } from 'commander'

// 从包元数据读取版本，避免 CLI 版本号与 package.json 不一致。
const packageJson = createRequire(import.meta.url)('../package.json') as { version: string }

program.version(packageJson.version)
program.parse()
