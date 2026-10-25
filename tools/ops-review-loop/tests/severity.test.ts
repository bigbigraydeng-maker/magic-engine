import { describe, expect, it } from 'vitest'
import { isActionable, isMergeBlockingSeverity } from '../src/severity.mjs'

describe('isActionable', () => {
  it.each(['P0', 'P1', 'P2', '[P0] null deref', 'severity: P1', '**P2** minor nit'])(
    'treats %s as actionable',
    (text) => {
      expect(isActionable(text)).toBe(true)
    }
  )

  it('is case-insensitive', () => {
    expect(isActionable('p0: crash on null input')).toBe(true)
  })

  it.each(['Looks good to me, no issues.', 'Consider renaming this variable.', '', undefined, null])(
    'treats %s as not actionable',
    (text) => {
      expect(isActionable(text)).toBe(false)
    }
  )

  it('does not false-positive on an unrelated "P0"-shaped substring inside a word', () => {
    expect(isActionable('this references PP0X, not a severity tag')).toBe(false)
  })
})

describe('isMergeBlockingSeverity', () => {
  it('blocks P0 and P1, including the badge shape Codex posts', () => {
    expect(isMergeBlockingSeverity('![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)')).toBe(true)
    expect(isMergeBlockingSeverity('P0')).toBe(true)
  })

  it('does not block P2 or a clean Codex receipt', () => {
    expect(isMergeBlockingSeverity('![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)')).toBe(false)
    expect(isMergeBlockingSeverity("Codex Review: Didn't find any major issues. Delightful!")).toBe(false)
    expect(isMergeBlockingSeverity('Looks good to me, no issues.')).toBe(false)
  })
})
