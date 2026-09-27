import { parseLedgerFile } from './parse'
import { FROZEN_FIELDS, type FrozenField, type LedgerParseError } from './types'

export interface FrozenFieldViolation {
  file: string
  field: FrozenField
  baseValue: string
  headValue: string
}

export interface FrozenFieldResult {
  violations: FrozenFieldViolation[]
  parseError: LedgerParseError | null
  baseParseError: LedgerParseError | null
}

export function checkFrozenFields(
  file: string,
  headText: string,
  baseText: string | null,
): FrozenFieldResult {
  if (baseText === null) return { violations: [], parseError: null, baseParseError: null }

  const baseResult = parseLedgerFile(file, baseText)
  if (!baseResult.ok) return { violations: [], parseError: null, baseParseError: baseResult.error }

  const headResult = parseLedgerFile(file, headText)
  if (!headResult.ok) return { violations: [], parseError: headResult.error, baseParseError: null }

  const violations: FrozenFieldViolation[] = []
  const fieldMap: Record<FrozenField, keyof typeof baseResult.entry> = {
    id: 'id',
    title: 'title',
    decided_on: 'decidedOn',
    source: 'source',
    verify_by: 'verifyBy',
    verify_how: 'verifyHow',
  }

  for (const field of FROZEN_FIELDS) {
    const entryKey = fieldMap[field]
    const baseVal = String(baseResult.entry[entryKey] ?? '')
    const headVal = String(headResult.entry[entryKey] ?? '')
    if (baseVal !== headVal) {
      violations.push({ file, field, baseValue: baseVal, headValue: headVal })
    }
  }

  return { violations, parseError: null, baseParseError: null }
}
