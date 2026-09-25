import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLedgerFile } from './parse'
import type { LedgerEntry, LedgerParseError } from './types'

export const LEDGER_DIR = 'docs/ledger'

export interface LedgerLoad {
  entries: LedgerEntry[]
  errors: LedgerParseError[]
}

export function loadLedger(dir: string = join(process.cwd(), LEDGER_DIR)): LedgerLoad {
  // 目录不存在就让 readdirSync 抛错，由调用方决定怎么处理
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()

  const entries: LedgerEntry[] = []
  const errors: LedgerParseError[] = []

  // id 必须等于文件名（parse 里已校验），同目录不可能有两个同 id 的文件，不用再查重
  for (const file of files) {
    const result = parseLedgerFile(file, readFileSync(join(dir, file), 'utf8'))
    if (result.ok) entries.push(result.entry)
    else errors.push(result.error)
  }

  return { entries, errors }
}
