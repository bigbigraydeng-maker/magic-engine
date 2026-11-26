/**
 * Scan and replenish entries must not name a Meta write.
 * Confirm-time writes live in the winner executor, not in these files.
 * No live Meta calls.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WRITE_TOKENS = ['createAdFromPost', 'pauseAd(', 'activateAd', 'setCampaignStatus']

const PROPOSE_ONLY = [
  'src/app/api/cron/winner-reel-sync-daily/route.ts',
  'src/app/api/clients/[id]/ad-health/execute-prescription/route.ts',
  'src/lib/winner-reel-sync/engine.ts',
  'src/lib/winner-reel-sync/propose.ts',
]

describe('winner scan entries do not name Meta writes', () => {
  it.each(PROPOSE_ONLY)('%s', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    for (const token of WRITE_TOKENS) {
      expect(source, token).not.toContain(token)
    }
  })
})
