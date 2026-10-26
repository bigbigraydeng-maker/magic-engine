import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard: the payment tracker's read paths (list, drawer, overview) never select money columns.
 * Money, if added, is read only by the dedicated sales-progress page. These column lists are
 * string literals; this fails if someone widens them (or switches to select('*')).
 */
const MONEY = /total_minor|amount_minor|currency/
const FILES = ['booking-store-reads.ts', 'booking-overview-reads.ts']

describe('booking read paths do not select money columns', () => {
  for (const file of FILES) {
    const src = readFileSync(join(__dirname, '..', file), 'utf8')

    it(`${file} has no money column names`, () => {
      expect(src).not.toMatch(MONEY)
    })

    it(`${file} never selects *`, () => {
      expect(src).not.toMatch(/\.select\(\s*['"`]\*['"`]/)
    })
  }
})
