import { describe, expect, it } from 'vitest'
import { buildBoard, type BoardInput } from '../board'
import { pillarLabel } from '../pillars'
import { parseSkillCard } from '../parse'
import type { SkillCard, SkillPoint } from '../types'
import type { LedgerEntry } from '@/lib/ledger/types'

function point(over: Partial<SkillPoint> & Pick<SkillPoint, 'key' | 'state'>): SkillPoint {
  return { text: '点 ' + over.key, handoff: null, rule: null, note: null, mergedInto: null, ...over }
}

function makeCard(id: string, points: SkillPoint[], hasCorrection = false, pillar = 'ads'): SkillCard {
  return { id, file: id + '.md', title: '卡 ' + id, sourceUrl: null, hasCorrection, pillar, points }
}

function entry(
  id: string,
  status: LedgerEntry['status'],
  verifyBy: string | null,
  title = '交 74 号：查一件事',
): LedgerEntry {
  return {
    id,
    title,
    status,
    owner: 'agent',
    decidedOn: '2026-10-01',
    source: 'doc:docs/x.md',
    verifyBy,
    verifyHow: '看',
    doneOn: null,
    doneRef: null,
    verifiedRef: null,
    lastChecked: null,
    checkNote: null,
    body: '',
  }
}

const RULEBOOK = [
  '| **C-1** | 规则一 来自 2026-01-01-card-a |',
  '| **C-13** | 规则十三 |',
  '| **B-04 改幅与冷却** | 预算 |',
  '| RL-05 | 不往在投组里加广告 |',
].join('\n')

const DIGEST = '- [PB B-06/PG§三十三] 某条\n- [CT§3-受众] 另一条'

function input(cards: SkillCard[], ledgerEntries: LedgerEntry[] = []): BoardInput {
  return {
    cards,
    errors: [],
    ledgerEntries,
    rulebookText: RULEBOOK,
    digestText: DIGEST,
    today: '2026-10-19',
  }
}

describe('pillarLabel', () => {
  it('ads 映射为「广告 Agent」', () => {
    expect(pillarLabel('ads')).toBe('广告 Agent')
  })

  it('seo 映射为「SEO Agent」', () => {
    expect(pillarLabel('seo')).toBe('SEO Agent')
  })

  it('未映射的 pillar 原样返回', () => {
    expect(pillarLabel('foo-pillar')).toBe('foo-pillar')
  })

  it('constructor 不被原型链吞掉', () => {
    expect(pillarLabel('constructor')).toBe('constructor')
  })
})

describe('parseSkillCard pillar 字段', () => {
  function parseWith(obj: unknown) {
    const text = '# 标题\n\n## 机器索引\n```json\n' + JSON.stringify(obj) + '\n```\n'
    return parseSkillCard('2026-01-01-card-a.md', text)
  }

  it('没写 pillar 时默认 ads', () => {
    const result = parseWith({ points: [{ key: 'a', text: 't', state: 'learning' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.pillar).toBe('ads')
  })

  it('pillar 为 seo 时保留 seo', () => {
    const result = parseWith({ pillar: 'seo', points: [{ key: 'a', text: 't', state: 'learning' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.pillar).toBe('seo')
  })

  it('pillar 前后空白被去掉', () => {
    const result = parseWith({ pillar: '  seo  ', points: [{ key: 'a', text: 't', state: 'learning' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.pillar).toBe('seo')
  })

  it('pillar 为空串时默认 ads', () => {
    const result = parseWith({ pillar: '', points: [{ key: 'a', text: 't', state: 'learning' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.card.pillar).toBe('ads')
  })

  it('pillar 不是字符串时解析失败', () => {
    const result = parseWith({ pillar: 5, points: [{ key: 'a', text: 't', state: 'learning' }] })
    expect(result.ok).toBe(false)
  })
})

describe('buildBoard 按 Agent 分组', () => {
  it('默认只有 ads 一个 Agent 块', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(input([card]))
    expect(board.pillars).toHaveLength(1)
    expect(board.pillars[0].pillar).toBe('ads')
    expect(board.pillars[0].label).toBe('广告 Agent')
  })

  it('按 Agent 分组并统计各状态数量', () => {
    const card1 = makeCard('2026-01-01-card-a', [
      point({ key: 'l1', state: 'learning' }),
      point({ key: 'l2', state: 'learning' }),
      point({ key: 'p1', state: 'pm_decision' }),
      point({ key: 'n1', state: 'not_applicable', note: 'n' }),
    ])
    const card2 = makeCard(
      '2026-01-01-card-b',
      [
        point({ key: 'l3', state: 'learning' }),
        point({ key: 'p2', state: 'pm_decision' }),
        point({ key: 'p3', state: 'pm_decision' }),
      ],
      false,
      'seo',
    )
    const board = buildBoard(input([card1, card2]))
    expect(board.pillars.map((b) => b.pillar)).toEqual(['ads', 'seo'])
    const ads = board.pillars[0]
    const seo = board.pillars[1]
    expect(ads.counts).toEqual({ learning: 2, verifying: 0, pmDecision: 1, passed: 1, adopted: 0 })
    expect(seo.counts).toEqual({ learning: 1, verifying: 0, pmDecision: 2, passed: 0, adopted: 0 })
  })

  it('只有 learning 时 decisions 与 overdue 都为空', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(input([card]))
    const block = board.pillars[0]
    expect(block.decisions.shown).toEqual([])
    expect(block.decisions.more).toBe(0)
    expect(block.overdue.shown).toEqual([])
    expect(block.overdue.more).toBe(0)
  })

  it('decisions 最多显示 5 条，其余计入 more', () => {
    const points: SkillPoint[] = []
    for (let i = 0; i < 7; i++) points.push(point({ key: 'p' + i, state: 'pm_decision' }))
    const card = makeCard('2026-01-01-card-a', points)
    const board = buildBoard(input([card]))
    const block = board.pillars[0]
    expect(block.decisions.shown).toHaveLength(5)
    expect(block.decisions.more).toBe(2)
    expect(block.counts.pmDecision).toBe(7)
  })

  it('overdue 只列逾期的 verifying，pm_decision 不进 overdue', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'v-a', state: 'verifying', handoff: 'h-a' }),
      point({ key: 'v-b', state: 'verifying', handoff: 'h-b' }),
      point({ key: 'p', state: 'pm_decision' }),
    ])
    const board = buildBoard(
      input([card], [entry('h-a', 'decided', '2026-10-01'), entry('h-b', 'decided', '2026-12-01')]),
    )
    const block = board.pillars[0]
    expect(block.counts.verifying).toBe(2)
    expect(block.overdue.shown).toHaveLength(1)
    expect(block.overdue.shown[0].key).toBe('v-a')
    expect(block.overdue.shown.some((i) => i.key === 'p')).toBe(false)
  })

  it('未映射的 Agent 原样显示，且排在 ads 之后', () => {
    const cardNew = makeCard(
      '2026-01-01-card-new',
      [point({ key: 'l', state: 'learning' })],
      false,
      'new-thing',
    )
    const cardAds = makeCard('2026-01-01-card-ads', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(input([cardNew, cardAds]))
    expect(board.pillars.map((b) => b.pillar)).toEqual(['ads', 'new-thing'])
    const block = board.pillars[1]
    expect(block.label).toBe('new-thing')
  })

  it('already_in_me 不计入任何 Agent 计数', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'r', state: 'already_in_me', rule: 'C-1' }),
      point({ key: 'l', state: 'learning' }),
    ])
    const board = buildBoard(input([card]))
    const block = board.pillars[0]
    expect(block.counts).toEqual({ learning: 1, verifying: 0, pmDecision: 0, passed: 0, adopted: 0 })
  })

  it('孤儿交接卡进 ads 块并标 orphan', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(
      input([card], [entry('x-skill-handoff-1', 'decided', '2026-10-01')]),
    )
    const block = board.pillars[0]
    expect(block.pillar).toBe('ads')
    expect(block.counts.verifying).toBe(1)
    expect(block.overdue.shown).toHaveLength(1)
    expect(block.overdue.shown[0].orphan).toBe(true)
  })
})
