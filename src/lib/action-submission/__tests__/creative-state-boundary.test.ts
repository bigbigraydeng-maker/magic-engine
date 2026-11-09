/**
 * The decision and the card issuer must not name a Meta write.
 * Confirm-time writes live in the live port file, and only after a person confirms.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WRITE_TOKENS = ['createAdFromPost', 'pauseAd(', 'pauseConfirmedWinnerAd', 'graph.facebook.com', 'getMetaTokenForClient']

const PROPOSE_ONLY = [
  'src/lib/creative-state/rules.ts',
  'src/lib/creative-state/copy.ts',
  'src/lib/action-submission/creative-state-card.ts',
]

describe('creative state proposal does not name Meta writes', () => {
  it.each(PROPOSE_ONLY)('%s', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    for (const token of WRITE_TOKENS) expect(source, token).not.toContain(token)
    expect(source).not.toContain('target_cost_per_primary = 11')
  })
})
