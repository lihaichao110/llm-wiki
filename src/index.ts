#!/usr/bin/env node

import '@/commands/start'
import '@/commands/compile'
import '@/commands/vector'
import { program } from 'commander'

program.parse()
