import { describe, expect, it } from 'vitest'
import { buildBoard } from '../board'
import { loadSkillCards } from '../load'
import { loadLedger } from '@/lib/ledger/load'

describe('仓库里的真实技能卡', () => {
  it('全部有机器索引、能解析', () => {
    const loaded = loadSkillCards()
    expect(loaded.errors, JSON.stringify(loaded.errors)).toEqual([])
    expect(loaded.cards.length).toBeGreaterThanOrEqual(9)
    expect(loaded.rulebookText.length).toBeGreaterThan(0)
    expect(loaded.resourcesByPillar.social.rulebookText.length).toBeGreaterThan(0)
    expect(loaded.resourcesByPillar.social.digestText.length).toBeGreaterThan(0)
  })

  it('零 error 级数据对不上、无致命错误', () => {
    const loaded = loadSkillCards()
    const board = buildBoard({
      cards: loaded.cards,
      errors: loaded.errors,
      ledgerEntries: loadLedger().entries,
      resourcesByPillar: loaded.resourcesByPillar,
      rulebookText: loaded.rulebookText,
      digestText: loaded.digestText,
      today: '2026-10-19',
    })
    expect(board.fatal).toBeNull()
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors, JSON.stringify(errors)).toEqual([])
    for (const w of board.issues.filter((i) => i.level === 'warning')) {
      console.log(`::warning::${w.cardId}: ${w.message}`)
    }
  })

  it('四个大数字加起来等于除合并外的全部点（另加孤儿交接卡）', () => {
    const loaded = loadSkillCards()
    const board = buildBoard({
      cards: loaded.cards,
      errors: loaded.errors,
      ledgerEntries: loadLedger().entries,
      resourcesByPillar: loaded.resourcesByPillar,
      rulebookText: loaded.rulebookText,
      digestText: loaded.digestText,
      today: '2026-10-19',
    })
    const total = loaded.cards.reduce(
      (sum, card) => sum + card.points.filter((p) => p.state !== 'merged').length,
      0,
    )
    const orphans = board.groups.verifying.filter((i) => i.orphan).length
    const counted =
      board.counts.learning +
      board.counts.verifying +
      board.counts.passed +
      board.counts.adopted +
      board.counts.alreadyInMe -
      orphans
    expect(counted).toBe(total)
  })
})
