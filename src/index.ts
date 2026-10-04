#!/usr/bin/env node

import '@/commands/start'
import '@/commands/compile'
import { program } from 'commander'

program.parse()
