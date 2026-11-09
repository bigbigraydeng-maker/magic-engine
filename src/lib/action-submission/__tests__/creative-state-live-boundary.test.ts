/** Confirm-time writes stay in the live port file, and they call the existing wrappers. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('creative state confirm wrappers', () => {
  it('names the existing wrappers and not the graph host', () => {
    const live = readFileSync(join(process.cwd(), 'src/lib/action-submission/creative-state-live.ts'), 'utf8')
    expect(live).toContain('createAdFromPost')
    expect(live).toContain('pauseConfirmedWinnerAd')
    expect(live).not.toContain('graph.facebook.com')
  })
})
