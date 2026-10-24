import { parseLedgerFile } from './parse'
import { parseDocument } from 'yaml'
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

/** Only repair a broken plain scalar by wrapping its exact text; never normalise valid YAML. */
function isExactVerifyHowRepair(file: string, baseText: string, headText: string): boolean {
  const baseFm = baseText.match(FM_RE)?.[1]
  const headFm = headText.match(FM_RE)?.[1]
  if (!baseFm || !headFm || !parseLedgerFile(file, headText).ok) return false
  try {
    if (parseDocument(baseFm).errors.length === 0) return false
    const lines = baseFm.split(/\r?\n/)
    const indices = lines.flatMap((line, i) => line.startsWith('verify_how:') ? [i] : [])
    if (indices.length !== 1) return false
    const index = indices[0]
    const raw = lines[index]
    if (!raw.startsWith('verify_how: ') || /^\s/.test(lines[index + 1] ?? '')) return false
    const value = raw.slice('verify_how: '.length)
    if (!value || value !== value.trim() || /[\u0000-\u001f\u007f#]/.test(value)) return false
    if (`'"|>[]{}&*!%@\`-?:`.includes(value[0])) return false
    const wrapped = `verify_how: |-\n  ${value}`
    if (extractRawField(headText, 'verify_how') !== wrapped) return false
    lines[index] = wrapped
    const repaired = parseDocument(lines.join('\n'))
    const head = parseDocument(headFm)
    return repaired.errors.length === 0 && repaired.warnings.length === 0 &&
      head.errors.length === 0 && head.warnings.length === 0 &&
      repaired.get('verify_how') === value && head.get('verify_how') === value
  } catch {
    return false
  }
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
      if (field === 'verify_how' && isExactVerifyHowRepair(file, baseText, headText)) continue
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
