/**
 * 真买家判定 + 自动打标三道闸。
 *
 * 这里的每一条都属于「写错了不会报错，只会安静地骗人」：分母算脏之后
 * 「每个真买家多少钱」会显得比真实便宜，而没有任何东西会报警。
 *
 * 变异验证（2026-08-01 实跑，三处，详见 PR 描述）：
 *   ① judgeQualifiedBuyer 里「只数客户发的」改成数所有消息
 *      （`input.messages.filter(m => m.direction === 'inbound')` → `[...input.messages]`）
 *      → 「只数客户发的」那组 3 条变红
 *   ② decideAutoTags 里去掉 `if (!canAutoUpgradeStage(...)) continue`
 *      → 「绝不覆盖人工判断」那组 8 条变红
 *   ③ QUALIFIED_MIN_INBOUND_MESSAGES 3 → 1
 *      → 「够不够 3 条」那组 3 条变红
 */

import { describe, expect, it } from 'vitest'
import {
  judgeQualifiedBuyer,
  detectViewingRequest,
  decideAutoTags,
  canAutoUpgradeStage,
  QUALIFIED_MIN_INBOUND_MESSAGES,
  AUTO_TAG_ACTOR,
  AUTO_UPGRADE_TARGET_STAGE,
  type ContactEvidence,
  type QualifiedBuyerMessage,
} from '../qualified-buyer'

/** n 条客户发的消息（内容无所谓，规则一只数条数）。 */
function inbound(n: number, body = '你好'): QualifiedBuyerMessage[] {
  return Array.from({ length: n }, () => ({ direction: 'inbound' as const, body }))
}

/** n 条我们回的消息。 */
function outbound(n: number, body = '您好，这套房还在售'): QualifiedBuyerMessage[] {
  return Array.from({ length: n }, () => ({ direction: 'outbound' as const, body }))
}

function person(over: Partial<ContactEvidence> = {}): ContactEvidence {
  return {
    clientId: 'client-a',
    contactId: 'c1',
    currentStage: null,
    messages: inbound(3),
    customerNeeds: [],
    ...over,
  }
}

describe('规则一 A · 只数客户发的消息', () => {
  it('客户发了 3 条 → 是真买家', () => {
    const v = judgeQualifiedBuyer({ messages: inbound(3) })
    expect(v.qualified).toBe(true)
    expect(v.rules).toContain('inbound_messages')
    expect(v.inboundCount).toBe(3)
  })

  it('客户只发 1 条、我们回了 5 条 → 不是真买家（我们自己多发不算数）', () => {
    // 🔴 这一条就是 PM 选「只数 inbound」而不是「数消息总数」的全部理由：
    // 数总数的话，我们自己多回两句就能把一个人「变成」真买家，方向是反的。
    const v = judgeQualifiedBuyer({ messages: [...inbound(1), ...outbound(5)] })
    expect(v.qualified).toBe(false)
    expect(v.inboundCount).toBe(1)
  })

  it('一条客户消息都没有、全是我们群发的 → 不是真买家', () => {
    const v = judgeQualifiedBuyer({ messages: outbound(9) })
    expect(v.qualified).toBe(false)
    expect(v.inboundCount).toBe(0)
  })

  it('inboundCount 报的是客户发的条数，不是消息总数', () => {
    const v = judgeQualifiedBuyer({ messages: [...inbound(2), ...outbound(7)] })
    expect(v.inboundCount).toBe(2)
    expect(v.inboundCount).not.toBe(9)
  })
})

describe('规则一 A · 够不够 3 条', () => {
  it('门槛就是 3，改了这个数下面三条会变红', () => {
    expect(QUALIFIED_MIN_INBOUND_MESSAGES).toBe(3)
  })

  it('客户发 2 条 → 还不够', () => {
    expect(judgeQualifiedBuyer({ messages: inbound(2) }).qualified).toBe(false)
  })

  it('客户发 1 条 → 还不够', () => {
    expect(judgeQualifiedBuyer({ messages: inbound(1) }).qualified).toBe(false)
  })

  it('客户发 4 条 → 够（≥ 不是 =）', () => {
    expect(judgeQualifiedBuyer({ messages: inbound(4) }).qualified).toBe(true)
  })
})

describe('规则一 B · 表达了想看房', () => {
  it('客户自己说想去看房 → 是真买家，哪怕只发了一条', () => {
    const v = judgeQualifiedBuyer({
      messages: [{ direction: 'inbound', body: '请问周六可以去看房吗？' }],
    })
    expect(v.qualified).toBe(true)
    expect(v.rules).toEqual(['viewing_requested'])
    expect(v.inboundCount).toBe(1)
  })

  it('英文说法也认，大小写无关', () => {
    const v = judgeQualifiedBuyer({
      messages: [{ direction: 'inbound', body: 'Is there an OPEN HOME this weekend?' }],
    })
    expect(v.rules).toContain('viewing_requested')
  })

  it('复用简报的 customer_needs —— 客户用英文说的，简报把它写成了中文', () => {
    const v = judgeQualifiedBuyer({
      messages: [{ direction: 'inbound', body: 'any chance I could pop round on Saturday?' }],
      brief: { customerNeeds: ['想周六去看房'] },
    })
    expect(v.rules).toContain('viewing_requested')
  })

  it('🔴 我们自己发的「欢迎来看房」不算他的意向', () => {
    // 跟规则一 A 是同一个方向错误：我们说的话不能把人变成真买家。
    const v = judgeQualifiedBuyer({
      messages: [
        { direction: 'outbound', body: '欢迎周六来看房，开放日 2-3 点' },
        { direction: 'inbound', body: '好的' },
      ],
    })
    expect(v.qualified).toBe(false)
    expect(v.rules).not.toContain('viewing_requested')
  })

  it('普通问价不算想看房', () => {
    const v = judgeQualifiedBuyer({
      messages: [{ direction: 'inbound', body: '这套多少钱？' }],
    })
    expect(v.qualified).toBe(false)
  })

  it('依据里带得出原话（审计要有出处）', () => {
    const v = judgeQualifiedBuyer({
      messages: [{ direction: 'inbound', body: '我想约看这套房' }],
    })
    expect(v.evidence).toContain('我想约看这套房')
  })

  it('两条规则都命中就都记下来', () => {
    const v = judgeQualifiedBuyer({
      messages: [...inbound(2), { direction: 'inbound', body: '能约个时间看房吗' }],
    })
    expect(v.rules).toEqual(['inbound_messages', 'viewing_requested'])
  })
})

describe('detectViewingRequest', () => {
  it('空文本 / 全空格一律不算命中', () => {
    expect(detectViewingRequest(['', '   ', null as unknown as string])).toBeNull()
  })

  it('原话过长时截断，但仍带得出上下文', () => {
    const long = `我们全家商量了很久${'很'.repeat(200)}想去看房`
    const hit = detectViewingRequest([long])
    expect(hit).not.toBeNull()
    expect(hit!.excerpt.length).toBeLessThanOrEqual(81)
  })
})

describe('🔴 闸门一 · 绝不覆盖人工判断', () => {
  it('从没标过（null）→ 允许自动升级', () => {
    expect(canAutoUpgradeStage(null)).toBe(true)
    expect(decideAutoTags([person({ currentStage: null })])).toHaveLength(1)
  })

  it.each(['new', 'contacted'])('停在「%s」→ 允许自动升级', (stage) => {
    expect(canAutoUpgradeStage(stage)).toBe(true)
    expect(decideAutoTags([person({ currentStage: stage })])).toHaveLength(1)
  })

  it.each(['open_home_booked', 'open_home_attended', 'offer', 'purchased'])(
    '人已经手工推到「%s」→ 一律不动',
    (stage) => {
      expect(canAutoUpgradeStage(stage)).toBe(false)
      expect(decideAutoTags([person({ currentStage: stage })])).toEqual([])
    },
  )

  it.each(['not_interested', 'no_response'])('人已经手工标了出口档「%s」→ 一律不动', (stage) => {
    expect(canAutoUpgradeStage(stage)).toBe(false)
    expect(decideAutoTags([person({ currentStage: stage })])).toEqual([])
  })

  it('已经在「真买家」这一档 → 不重复写、不重复留审计', () => {
    expect(decideAutoTags([person({ currentStage: AUTO_UPGRADE_TARGET_STAGE })])).toEqual([])
  })

  it('没见过的档（客户自己配的新档）→ 保守不动', () => {
    expect(canAutoUpgradeStage('needs_mortgage_approval')).toBe(false)
    expect(decideAutoTags([person({ currentStage: 'needs_mortgage_approval' })])).toEqual([])
  })
})

describe('🔴 闸门二 · 只升不降', () => {
  it('自动升级的目标永远只有「真买家」一档', () => {
    const decisions = decideAutoTags([person({ currentStage: 'contacted' })])
    expect(decisions.map((d) => d.toStage)).toEqual([AUTO_UPGRADE_TARGET_STAGE])
  })

  it('地产漏斗里排在「真买家」之后的每一档都进不来 = 结构上不可能降级', () => {
    const laterStages = ['open_home_booked', 'open_home_attended', 'offer', 'purchased']
    const decisions = decideAutoTags(
      laterStages.map((s, i) => person({ contactId: `c${i}`, currentStage: s })),
    )
    expect(decisions).toEqual([])
  })
})

describe('🔴 闸门三 · 审计写明是自动标的', () => {
  it('操作者标记跟人的邮箱长得不一样，分得开', () => {
    expect(AUTO_TAG_ACTOR).toBe('system:qualified-buyer')
    expect(AUTO_TAG_ACTOR).not.toContain('@')
  })

  it('每条决定都带得出依据（写进审计 note）', () => {
    const [d] = decideAutoTags([person({ currentStage: 'new', messages: inbound(5) })])
    expect(d.fromStage).toBe('new')
    expect(d.verdict.evidence).toContain('5 条')
    expect(d.verdict.rules).toContain('inbound_messages')
  })
})

describe('decideAutoTags · 批量', () => {
  it('不够格的人不进结果', () => {
    const decisions = decideAutoTags([
      person({ contactId: 'ok', messages: inbound(3) }),
      person({ contactId: 'thin', messages: inbound(1) }),
      person({ contactId: 'ours', messages: outbound(9) }),
    ])
    expect(decisions.map((d) => d.contactId)).toEqual(['ok'])
  })

  it('空输入不炸', () => {
    expect(decideAutoTags([])).toEqual([])
  })
})

describe('看房意向 · 否定句必须挡住（复审补）', () => {
  // 复审时实测：加否定层之前，下面 6 句全部被判成「想看房」。
  // 后果不是漏标而是**误标**——把明确拒绝的人算进真买家，而真买家数正是
  // 判断这套房成不成功的指标，标错方向是往上虚报。
  const refusals = [
    '我不想看房',
    '暂时不考虑看房',
    '不用安排看房了',
    '看了照片就够了，不想去看房',
    'not interested in a viewing',
    'no need for an open home',
  ]
  for (const text of refusals) {
    it(`「${text}」不算意向`, () => {
      expect(detectViewingRequest([text])).toBeNull()
    })
  }

  it('肯定句照常命中', () => {
    expect(detectViewingRequest(['周六能约看房吗'])).not.toBeNull()
    expect(detectViewingRequest(['can I book a viewing this weekend'])).not.toBeNull()
  })

  it('先拒后允：同一句里有一处没被否定就算', () => {
    expect(detectViewingRequest(['这周不想看房，下周想约看房'])).not.toBeNull()
  })
})
