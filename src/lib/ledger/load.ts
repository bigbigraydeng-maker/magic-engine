import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLedgerFile } from './parse'
import type { LedgerEntry, LedgerParseError, LedgerWarning } from './types'

export const LEDGER_DIR = 'docs/ledger'

export interface LedgerLoad {
  entries: LedgerEntry[]
  errors: LedgerParseError[]
  warnings: LedgerWarning[]
}

export function loadLedger(dir: string = join(process.cwd(), LEDGER_DIR)): LedgerLoad {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()

  const entries: LedgerEntry[] = []
  const errors: LedgerParseError[] = []
  const warnings: LedgerWarning[] = []

  for (const file of files) {
    const result = parseLedgerFile(file, readFileSync(join(dir, file), 'utf8'))
    if (result.ok) {
      entries.push(result.entry)
      warnings.push(...result.warnings)
    } else {
      errors.push(result.error)
    }
  }

  return { entries, errors, warnings }
}
