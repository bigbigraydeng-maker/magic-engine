/**
 * 点开一个人之后给哪几个按钮。
 *
 * 2026-08-02 PM 看着「新客人，还没打过」点开后说「按钮是不是太多了！」——
 * 9 个阶段快捷键 + 10 项下拉 + 方向切换 + 输入框 + 私信框。而一个从没被联系过
 * 的人，只有两种结果：打通了，或者没打通。
 *
 * 这里钉两条底线：
 *   1. **绝不给一个他做不到的动作**。没有电话的人不许出现「没打通」——
 *      点下去等于往他的记录里写一句假话，而那句话还会让他明天落进
 *      「打过没人接」那一批。
 *   2. **一键动作必须自带那句话**。要销售打字才算数的，就不是一键。
 */

import { describe, expect, it } from 'vitest'
import { drawerActions, nextStageChoices, type StageLike } from '../drawer-actions'

describe('有电话的人', () => {
  it('新客人 → 打通了 / 没打通，两个键', () => {
    const a = drawerActions('new_untouched', 'phone')
    expect(a.map((x) => x.kind)).toEqual(['log', 'no_answer'])
    expect(a[0].label).toBe('打通了，记一笔')
  })

  it('打过没人接的人 → 还是「打通了 / 没打通」，任务仍是联系上他', () => {
    expect(drawerActions('retry_channel', 'phone').map((x) => x.kind)).toEqual(['log', 'no_answer'])
  })

  it('已经聊上的人 → 措辞变成「聊完了」，不再说「打通了」', () => {
    expect(drawerActions('replied', 'phone')[0].label).toBe('聊完了，记一笔')
  })

  it('「没打通」自带那句话 —— 一键就是一键，不用打字', () => {
    const noAnswer = drawerActions('new_untouched', 'phone')[1]
    expect(noAnswer.cannedNote).toBe('打了，没人接')
  })

  it('只有一个主按钮，其余是次按钮 —— 两个深色按钮等于没有主次', () => {
    const a = drawerActions('new_untouched', 'phone')
    expect(a.filter((x) => x.primary)).toHaveLength(1)
  })
})

describe('没有电话的人（CTS 有 110 个只有 Facebook 身份）', () => {
  /** 这条是底线：他根本没有号码可打，「没打通」点下去是往记录里写假话。 */
  it('只有私信 → 绝不出现「没打通」', () => {
    const a = drawerActions('new_untouched', 'messenger')
    expect(a.map((x) => x.kind)).toEqual(['log', 'sent_waiting'])
    expect(a.some((x) => x.label.includes('打不通') || x.label.includes('没打通'))).toBe(false)
  })

  it('只有邮箱 → 措辞说「发了邮件」，不说「回了他」', () => {
    expect(drawerActions('new_untouched', 'email')[0].label).toBe('发了邮件，记一笔')
  })

  /** 跟「没电话不给没打通」是同一类错误：他没有可发的地方。 */
  it('三样都没有 → 只剩记一笔，不给「发出去了，等他回」', () => {
    const a = drawerActions('new_untouched', 'none')
    expect(a.map((x) => x.kind)).toEqual(['log'])
  })

  it('「发出去了」也自带那句话', () => {
    expect(drawerActions('new_untouched', 'messenger')[1].cannedNote).toBe('回了私信，等他回')
  })
})

describe('结论已定的人', () => {
  /** 明确拒绝 / 号码作废 / 已成交 —— 不该再有「去联系他」的按钮。 */
  it('只剩记一笔，没有任何「去联系他」的动作', () => {
    const a = drawerActions('excluded', 'phone')
    expect(a.map((x) => x.kind)).toEqual(['log'])
  })
})

// ── 阶段 ─────────────────────────────────────────────────────────────────────

const STAGES: StageLike[] = [
  { stageKey: 'new', label: '新线索', sortOrder: 1 },
  { stageKey: 'contacted', label: '已联系', sortOrder: 2 },
  { stageKey: 'quoted', label: '已报价', sortOrder: 3 },
  { stageKey: 'deposit', label: '已付定金', sortOrder: 4 },
  { stageKey: 'paid', label: '已付全款', sortOrder: 5, isTerminal: true },
  { stageKey: 'lost', label: '不感兴趣', sortOrder: 9, marketingAction: 'suppress' },
]

describe('阶段只给下一步 + 一个出口', () => {
  it('还没标过的人 → 下一步是第一个阶段', () => {
    const { suggested } = nextStageChoices(STAGES, null)
    expect(suggested[0].stageKey).toBe('new')
  })

  it('已联系 → 下一步是已报价', () => {
    const { suggested } = nextStageChoices(STAGES, 'contacted')
    expect(suggested[0].stageKey).toBe('quoted')
  })

  /** 谈崩了随时要能一键标掉，不用先展开「其他」。 */
  it('永远带一个「谈崩了」的出口', () => {
    const { suggested } = nextStageChoices(STAGES, 'contacted')
    expect(suggested.some((s) => s.stageKey === 'lost')).toBe(true)
  })

  it('最多两个 —— 每多一个选项就多一次犹豫', () => {
    expect(nextStageChoices(STAGES, 'contacted').suggested.length).toBeLessThanOrEqual(2)
  })

  it('只给一个出口 —— 两个「谈崩了」会让人停下来分辨区别', () => {
    const withTwoExits = [...STAGES, { stageKey: 'dead', label: '号码作废', sortOrder: 10, isTerminal: true }]
    const exits = nextStageChoices(withTwoExits, 'contacted').suggested.filter(
      (s) => s.stageKey === 'lost' || s.stageKey === 'dead' || s.stageKey === 'paid',
    )
    expect(exits.length).toBe(1)
  })

  /** 折起来不是删掉 —— 剩下的必须一个不少地在「其他」里。 */
  it('没铺出来的一个都不许丢', () => {
    const { suggested, rest } = nextStageChoices(STAGES, 'contacted')
    const all = [...suggested, ...rest].map((s) => s.stageKey).sort()
    const expected = STAGES.filter((s) => s.stageKey !== 'contacted').map((s) => s.stageKey).sort()
    expect(all).toEqual(expected)
  })

  it('当前阶段自己不出现在选项里 —— 改成自己没有意义', () => {
    const { suggested, rest } = nextStageChoices(STAGES, 'quoted')
    expect([...suggested, ...rest].some((s) => s.stageKey === 'quoted')).toBe(false)
  })

  it('已经在最后一步 → 只剩出口，不硬凑一个下一步', () => {
    const { suggested } = nextStageChoices(STAGES, 'lost')
    expect(suggested.every((s) => s.stageKey !== 'lost')).toBe(true)
  })

  it('客户还没配阶段 → 不炸，空着', () => {
    expect(nextStageChoices([], null)).toEqual({ suggested: [], rest: [] })
  })
})
