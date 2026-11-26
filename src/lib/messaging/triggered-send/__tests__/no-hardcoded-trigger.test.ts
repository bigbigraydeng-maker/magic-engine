/**
 * Design 2026-11-17 §7.5 (Z2, W5): the files the AI follow-up letters go through take the kind of letter and the
 * ledger scope from the authorization / the scope, never from a literal. The values live in `trigger-scope.ts` only.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = join(__dirname, '..')
const FIRST_CUT_FILES = [
  'send-store.ts',
  'send-deps-prod.ts',
  'send-one.ts',
  'send-core.ts',
  'send-named-letter.ts',
  'authorization-store.ts',
  'authorization-core.ts',
  'authorization-commands.ts',
  'authorization-deps-prod.ts',
  'receipt.ts',
  'receipt-consumer.ts',
  'unsubscribe-entry.ts',
  'receipt-store-prod.ts',
  '../../inngest/triggered-send-events.ts',
]
const LITERAL_RE = /(['"`])(welcome|lifetime)\1|triggered-send:welcome:/

describe('no literal kind of letter or ledger scope in the first cut\'s files', () => {
  for (const file of FIRST_CUT_FILES) {
    it(file, () => {
      const lines = readFileSync(join(HERE, file), 'utf8').split('\n')
      const hits = lines.map((line, i) => ({ line: i + 1, text: line.trim() })).filter((l) => LITERAL_RE.test(l.text))
      expect(hits).toEqual([])
    })
  }

  it('the values themselves are in trigger-scope.ts', () => {
    const text = readFileSync(join(HERE, 'trigger-scope.ts'), 'utf8')
    expect(text).toMatch(/WELCOME_TRIGGER = 'welcome'/)
    expect(text).toMatch(/LIFETIME_SCOPE = 'lifetime'/)
  })
})
