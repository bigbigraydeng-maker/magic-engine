import { parseLedgerFile } from './parse'
import { FROZEN_FIELDS, type FrozenField, type LedgerParseError } from './types'

export interface FrozenFieldViolation {
  file: string
  field: FrozenField
  baseValue: string
  headValue: string
}

/**
 * 比对一张已在 base 上的台账卡，检查冻结字段是否被改写。
 * baseText = null 表示新卡（base 上不存在），跳过检查。
 */
export function checkFrozenFields(
  file: string,
  headText: string,
  baseText: string | null,
): { violations: FrozenFieldViolation[]; parseError: LedgerParseError | null } {
  if (baseText === null) return { violations: [], parseError: null }

  const baseResult = parseLedgerFile(file, baseText)
  if (!baseResult.ok) return { violations: [], parseError: null }

  const headResult = parseLedgerFile(file, headText)
  if (!headResult.ok) return { violations: [], parseError: headResult.error }

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

  return { violations, parseError: null }
}
