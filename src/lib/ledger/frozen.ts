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

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/

function extractRawField(text: string, field: string): string | null {
  const fmMatch = text.match(FM_RE)
  if (!fmMatch) return null
  const lines = fmMatch[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(field + ':')) {
      let raw = lines[i]
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s/.test(lines[j])) {
          raw += '\n' + lines[j]
        } else {
          break
        }
      }
      return raw
    }
  }
  return null
}

export function checkFrozenFields(
  file: string,
  headText: string,
  baseText: string | null,
): FrozenFieldResult {
  if (baseText === null) return { violations: [], parseError: null, baseParseError: null }

  const baseResult = parseLedgerFile(file, baseText)
  const headResult = parseLedgerFile(file, headText)

  const baseFm = FM_RE.test(baseText)
  const headFm = FM_RE.test(headText)

  if (!baseFm || !headFm) {
    return {
      violations: [],
      parseError: headResult.ok ? null : headResult.error,
      baseParseError: baseResult.ok ? null : baseResult.error,
    }
  }

  const violations: FrozenFieldViolation[] = []
  for (const field of FROZEN_FIELDS) {
    const baseRaw = extractRawField(baseText, field)
    const headRaw = extractRawField(headText, field)
    if (baseRaw === null) continue
    if (baseRaw !== headRaw) {
      const valPart = (s: string | null) =>
        s === null ? '（已删除）' : s.slice(s.indexOf(':') + 1).trimStart()
      violations.push({
        file,
        field,
        baseValue: valPart(baseRaw),
        headValue: valPart(headRaw),
      })
    }
  }

  return {
    violations,
    parseError: headResult.ok ? null : headResult.error,
    baseParseError: baseResult.ok ? null : baseResult.error,
  }
}
