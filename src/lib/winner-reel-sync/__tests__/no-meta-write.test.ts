/**
 * Under every config this scan used to be able to write Meta, it must not.
 * The paused publisher is a different module and is only reached after a person
 * confirms the existing card.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildWinnerPausedDraft } from '../paused-card'

describe('winner reel source does not call Meta write helpers', () => {
  it('engine and card request contain no write calls', () => {
    const root = join(process.cwd(), 'src/lib/winner-reel-sync')
    const engine = readFileSync(join(root, 'engine.ts'), 'utf8')
    const card = readFileSync(join(root, 'paused-card.ts'), 'utf8')
    const src = `${engine}\n${card}`
    expect(src).not.toMatch(/createAdFromPost|pauseAd|setAdSetDailyBudget|setAdSetStatus/)
    expect(src).not.toMatch(/status:\s*['"]ACTIVE['"]/)
    expect(engine).toContain('requestWinnerPausedCard')
    expect(engine).toContain('fatigue_pause_not_written')
  })
})

describe('one card for many winners', () => {
  it('two posts become one draft and do not invent a caption', () => {
    const built = buildWinnerPausedDraft({
      clientId: 'c1',
      pageId: '11111',
      adSetId: '123456',
      adSetName: 'Pool',
      dailyBudgetMajor: 20,
      winners: [
        { postId: '12345678', message: 'first reel', score: 9 },
        { postId: '22345678', message: '   ', score: 8 },
        { postId: '32345678', message: 'second reel', score: 7 },
      ],
    })
    expect(built.draft?.creatives).toHaveLength(2)
    expect(built.draft?.existingAdSetId).toBe('123456')
    expect(built.skipped).toBe(1)
    expect(built.draft?.creatives.map((c) => c.promotedPostId)).toEqual([
      '11111_12345678',
      '11111_32345678',
    ])
  })
})
