import { describe, expect, it } from 'vitest'
import { buildBoard, digestTags, findRuleRow, ownerFromTitle, rowMentionsCard, type BoardInput } from '../board'
import type { SkillCard, SkillPoint } from '../types'
import type { LedgerEntry } from '@/lib/ledger/types'

function point(over: Partial<SkillPoint> & Pick<SkillPoint, 'key' | 'state'>): SkillPoint {
  return { text: '点 ' + over.key, handoff: null, rule: null, note: null, mergedInto: null, ...over }
}

function makeCard(id: string, points: SkillPoint[], hasCorrection = false): SkillCard {
  return { id, file: id + '.md', title: '卡 ' + id, sourceUrl: null, hasCorrection, points }
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

describe('ownerFromTitle', () => {
  it('单个号', () => {
    expect(ownerFromTitle('交 74 号：x')).toBe('74 号')
  })

  it('两个号', () => {
    expect(ownerFromTitle('交 106 号和 74 号：x')).toBe('106 号和 74 号')
  })

  it('没有号时返回空串', () => {
    expect(ownerFromTitle('没有')).toBe('')
  })
})

describe('findRuleRow', () => {
  it('找到 C-1 那一行', () => {
    const row = findRuleRow(RULEBOOK, 'C-1')
    expect(row).not.toBeNull()
    expect(row).toContain('规则一')
  })

  it('找到 C-13 那一行', () => {
    const row = findRuleRow(RULEBOOK, 'C-13')
    expect(row).not.toBeNull()
    expect(row).toContain('规则十三')
  })

  it('C-2 找不到', () => {
    expect(findRuleRow(RULEBOOK, 'C-2')).toBeNull()
  })

  it('找到 B-04 那一行', () => {
    const row = findRuleRow(RULEBOOK, 'B-04')
    expect(row).not.toBeNull()
    expect(row).toContain('改幅与冷却')
  })

  it('找到 RL-05 那一行', () => {
    expect(findRuleRow(RULEBOOK, 'RL-05')).not.toBeNull()
  })

  it('只有 C-13 时找 C-1 返回 null', () => {
    expect(findRuleRow('| **C-13** | x |', 'C-1')).toBeNull()
  })
})

describe('digestTags', () => {
  it('拆出整段和斜杠两边的标签', () => {
    const tags = digestTags(DIGEST)
    expect(tags.has('PB B-06/PG§三十三')).toBe(true)
    expect(tags.has('PG§三十三')).toBe(true)
    expect(tags.has('PB B-06')).toBe(true)
    expect(tags.has('CT§3-受众')).toBe(true)
  })
})

describe('buildBoard 分组', () => {
  it('每个 state 落到正确的分组', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'l', state: 'learning' }),
      point({ key: 'p', state: 'pm_decision' }),
      point({ key: 'v', state: 'verifying', handoff: 'h-1' }),
      point({ key: 'a', state: 'adopted', rule: 'C-1' }),
      point({ key: 'n', state: 'not_applicable', note: 'x' }),
      point({ key: 't', state: 'tried_failed', handoff: 'h-2', note: 'x' }),
      point({ key: 'c', state: 'cannot_check', note: 'x' }),
      point({ key: 'r', state: 'already_in_me', rule: 'RL-05' }),
      point({ key: 'm', state: 'merged', mergedInto: '2026-01-01-card-a#l' }),
    ])
    const board = buildBoard(
      input([card], [entry('h-1', 'decided', '2026-12-01'), entry('h-2', 'failed', null)]),
    )
    expect(board.fatal).toBeNull()
    expect(board.issues).toEqual([])
    expect(board.groups.learning.map((i) => i.key)).toEqual(['l'])
    expect(board.groups.pm_decision.map((i) => i.key)).toEqual(['p'])
    expect(board.groups.verifying.map((i) => i.key)).toEqual(['v'])
    expect(board.groups.adopted.map((i) => i.key)).toEqual(['a'])
    expect(board.groups.passed.map((i) => i.key)).toEqual(['n', 't', 'c'])
    expect(board.groups.already_in_me.map((i) => i.key)).toEqual(['r'])
    expect(board.counts.learning).toBe(2)
    expect(board.counts.pmDecision).toBe(1)
    expect(board.counts.verifying).toBe(1)
    expect(board.counts.passed).toBe(3)
    expect(board.counts.adopted).toBe(1)
    expect(board.counts.alreadyInMe).toBe(1)
    const allKeys = Object.values(board.groups).flatMap((items) => items.map((i) => i.key))
    expect(allKeys).not.toContain('m')
  })
})

describe('buildBoard 校验', () => {
  it('verifying 的交接卡在台账里找不到时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'v', state: 'verifying', handoff: 'h-missing' }),
    ])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('找不到')
  })

  it('verifying 的台账已判不成立时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'v', state: 'verifying', handoff: 'h-1' }),
    ])
    const board = buildBoard(input([card], [entry('h-1', 'failed', null)]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('tried_failed')
  })

  it('verifying 的台账已验完时标记 verifiedPending', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'v', state: 'verifying', handoff: 'h-1' }),
    ])
    const board = buildBoard(input([card], [entry('h-1', 'verified', null)]))
    expect(board.issues).toEqual([])
    expect(board.groups.verifying[0].verifiedPending).toBe(true)
  })

  it('verifying 逾期时标记 overdue 并带出 owner', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'v', state: 'verifying', handoff: 'h-1' }),
    ])
    const overdueBoard = buildBoard(input([card], [entry('h-1', 'decided', '2026-10-01')]))
    expect(overdueBoard.groups.verifying[0].overdue).toBe(true)
    expect(overdueBoard.groups.verifying[0].owner).toBe('74 号')

    const futureBoard = buildBoard(input([card], [entry('h-1', 'decided', '2026-12-01')]))
    expect(futureBoard.groups.verifying[0].overdue).toBe(false)
  })

  it('tried_failed 但台账还没验完时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 't', state: 'tried_failed', handoff: 'h-1', note: 'x' }),
    ])
    const board = buildBoard(input([card], [entry('h-1', 'decided', '2026-12-01')]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('failed')
  })

  it('adopted 的规则行没写本卡文件名时报错', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'a', state: 'adopted', rule: 'C-13' })])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('没写本卡文件名')
  })

  it('adopted 的规则手册里找不到时报错', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'a', state: 'adopted', rule: 'C-2' })])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('找不到 C-2')
  })

  it('adopted 的 rule 不是规则编号时报错', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'a', state: 'adopted', rule: 'PG§三十三' })])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('规则手册编号')
  })

  it('already_in_me 的摘要标签能对上时不报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'r1', state: 'already_in_me', rule: 'PG§三十三' }),
      point({ key: 'r2', state: 'already_in_me', rule: 'CT§3-受众' }),
      point({ key: 'r3', state: 'already_in_me', rule: 'B-04' }),
    ])
    const board = buildBoard(input([card]))
    expect(board.issues).toEqual([])
  })

  it('already_in_me 的摘要标签对不上时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'r', state: 'already_in_me', rule: 'XX§9' }),
    ])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('规则摘要里没有')
  })

  it('already_in_me 的规则编号在手册里找不到时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'r', state: 'already_in_me', rule: 'S-99' }),
    ])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('S-99')
  })

  it('merged 指向的点不存在时报错', () => {
    const card = makeCard('2026-01-01-card-a', [
      point({ key: 'm', state: 'merged', mergedInto: '2026-01-01-card-a#nope' }),
    ])
    const board = buildBoard(input([card]))
    const errors = board.issues.filter((i) => i.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('不存在')
  })

  it('有复核更正但没点注明时给 warning', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })], true)
    const board = buildBoard(input([card]))
    const warnings = board.issues.filter((i) => i.level === 'warning')
    expect(warnings).toHaveLength(1)
  })

  it('有复核更正且有点注明时不给 warning', () => {
    const card = makeCard(
      '2026-01-01-card-a',
      [point({ key: 'l', state: 'learning', note: '复核更正后：x' })],
      true,
    )
    const board = buildBoard(input([card]))
    expect(board.issues).toEqual([])
  })
})

describe('buildBoard 孤儿交接卡', () => {
  it('没被引用的交接卡进 verifying 并标 orphan', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(
      input(
        [card],
        [
          entry('2026-10-18-skill-handoff-74-x', 'decided', '2026-10-01'),
          entry('2026-10-18-other', 'decided', '2026-10-01'),
        ],
      ),
    )
    const orphans = board.groups.verifying.filter((i) => i.orphan)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].key).toBe('2026-10-18-skill-handoff-74-x')
    expect(orphans[0].overdue).toBe(true)
    expect(board.issues).toEqual([])
    const keys = board.groups.verifying.map((i) => i.key)
    expect(keys).not.toContain('2026-10-18-other')
  })
})

describe('buildBoard 致命错误', () => {
  it('没有卡时整页报致命错误', () => {
    const board = buildBoard(input([]))
    expect(board.fatal).not.toBeNull()
    expect(board.counts).toEqual({
      learning: 0,
      pmDecision: 0,
      verifying: 0,
      passed: 0,
      adopted: 0,
      alreadyInMe: 0,
    })
    expect(board.issues).toEqual([])
  })

  it('规则手册为空时整页报致命错误', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard({ ...input([card]), rulebookText: '  ' })
    expect(board.fatal).not.toBeNull()
  })
})

describe('buildBoard 未整理卡', () => {
  it('解析失败的卡进 unorganized，不影响正常卡', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard({
      ...input([card]),
      errors: [{ file: 'x.md', reason: '没有「## 机器索引」一节' }],
    })
    expect(board.unorganized).toHaveLength(1)
    expect(board.fatal).toBeNull()
  })
})

describe('评审补丁（子牙/魏征实施后审）', () => {
  it('规则行里的卡名整名匹配：-foo 不得命中 -foo-bar', () => {
    expect(rowMentionsCard('| **C-1** | 来自 2026-01-01-foo-bar.md |', '2026-01-01-foo')).toBe(false)
    expect(rowMentionsCard('| **C-1** | 来自 2026-01-01-foo.md |', '2026-01-01-foo')).toBe(true)
    expect(rowMentionsCard('| **C-1** | 来自 2026-01-01-foo，见上 |', '2026-01-01-foo')).toBe(true)
  })

  it('同一编号出现多行时，任一行写了卡名即算 adopted', () => {
    const card = makeCard('2026-01-01-card-b', [point({ key: 'a', state: 'adopted', rule: 'E-13' })])
    const rulebook = '| **E-13** | 旧行 |\n| **E-13** | 新行 来自 2026-01-01-card-b.md |'
    const board = buildBoard({ ...input([card]), rulebookText: rulebook })
    expect(board.issues).toEqual([])
    expect(board.counts.adopted).toBe(1)
  })

  it('tried_failed 只认台账 failed；台账 verified 也要报错', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 't', state: 'tried_failed', handoff: 'h-1', note: '不成立' })])
    const board = buildBoard(input([card], [entry('h-1', 'verified', null)]))
    expect(board.issues.filter((i) => i.level === 'error')).toHaveLength(1)
  })

  it('台账判失败的孤儿交接卡进 pass，不算待验证', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard(input([card], [entry('2026-10-18-skill-handoff-74-y', 'failed', null)]))
    expect(board.counts.verifying).toBe(0)
    expect(board.groups.passed.map((i) => i.key)).toContain('2026-10-18-skill-handoff-74-y')
  })

  it('台账读不出的文件进红区，不被吞掉', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    const board = buildBoard({ ...input([card]), ledgerErrors: [{ file: 'bad.md', reason: '缺字段' }] })
    expect(board.issues.some((i) => i.level === 'error' && i.message.includes('bad.md'))).toBe(true)
  })

  it('页面显示读到的卡数', () => {
    const card = makeCard('2026-01-01-card-a', [point({ key: 'l', state: 'learning' })])
    expect(buildBoard(input([card])).cardCount).toBe(1)
  })
})
