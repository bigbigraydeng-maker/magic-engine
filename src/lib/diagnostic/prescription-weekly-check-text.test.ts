import { describe, expect, it } from 'vitest'
import {
  countLinkedAdDrafts,
  countPrescriptionActions,
  countWorkOrders,
  describePrescriptionCheck,
  personalIpSuggestions,
  pickInActPrescriptions,
  type PrescriptionCheckFacts,
} from './prescription-weekly-check-text'

function facts(over: Partial<PrescriptionCheckFacts> = {}): PrescriptionCheckFacts {
  return {
    goalTitle: '春季咨询',
    goalLinked: true,
    approvedOn: '2026-10-20T08:00:00.000Z',
    initiativesKnown: true,
    initiativeCount: 2,
    goalActions: { completed: 1, inProgress: 0, pending: 2, skipped: 0, superseded: 0, other: 0 },
    prescriptionActions: { completed: 0, inProgress: 0, pending: 0, skipped: 0, superseded: 0, other: 0 },
    workOrders: { doing: 0, published: 0, stuck: 0, other: 0 },
    adDrafts: { waiting: 0, active: 0, rejected: 0, other: 0 },
    campaigns: { total: 0 },
    metric: {
      label: '新增咨询',
      baseline: 8,
      current: 12,
      target: 30,
      direction: 'increase',
      fetchedOn: '2026-10-20T00:00:00.000Z',
    },
    measuredKpis: [],
    readsCapped: false,
    ...over,
  }
}

describe('pickInActPrescriptions', () => {
  it('只留每个目标最新一份已批准的方案，草稿和被拒绝的不进复查', () => {
    const picked = pickInActPrescriptions([
      { id: 'b', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-01T00:00:00Z' },
      { id: 'a', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
      { id: 'd', client_id: 'c1', goal_id: 'g1', status: 'draft', approved_at: null },
      { id: 'r', client_id: 'c1', goal_id: 'g1', status: 'rejected', approved_at: '2026-10-21T00:00:00Z' },
      { id: 'o', client_id: 'c1', goal_id: 'g2', status: 'approved', approved_at: '2026-10-18T00:00:00Z' },
    ])
    expect(picked.map((row) => row.id).sort()).toEqual(['a', 'o'])
  })
})

describe('count helpers', () => {
  it('工单卡住和已发出分开数，收起的不计入', () => {
    expect(countWorkOrders(['failed', 'published', 'queued', 'archived', 'superseded', 'weird'])).toEqual({
      doing: 1, published: 1, stuck: 1, other: 1,
    })
  })

  it('广告草稿只认状态，认不出的不算已打开', () => {
    expect(countLinkedAdDrafts([
      { status: 'awaiting_approval' },
      { status: 'active' },
      { status: 'dry_run_logged' },
      { status: 'nope' },
      null,
    ])).toEqual({ waiting: 1, active: 1, rejected: 0, other: 2 })
  })

  it('看板上已收起的待办不算还没开始', () => {
    expect(countPrescriptionActions(['pending', 'superseded', 'completed'])).toMatchObject({
      pending: 1, superseded: 1, completed: 1,
    })
  })
})

describe('describePrescriptionCheck', () => {
  it('看板上没有待办时，不报「一个都没排出来」', () => {
    const text = describePrescriptionCheck(facts())
    expect(text.progress).not.toContain('一个可执行动作都没排出来')
    expect(text.progress).not.toContain('等于这周没往前推')
    expect(text.progress).toContain('不会再往看板上插待办')
    expect(text.progress).toContain('所以这不是故障')
    expect(text.progress).not.toContain('{')
    expect(text.suggestion).not.toContain('{')
  })

  it('数字只对照，不说成是这份方案造成的', () => {
    const text = describePrescriptionCheck(facts())
    expect(text.progress).toContain('现在是 12')
    expect(text.progress).toContain('开始时是 8')
    expect(text.progress).toContain('要到的是 30')
    expect(text.progress).toContain('不能当成这份方案造成的')
    expect(text.progress).not.toContain('成功')
  })

  it('没读到当前数字时，不把它说成变好或变差', () => {
    const text = describePrescriptionCheck(facts({
      metric: { label: '新增咨询', baseline: 8, current: null, target: 30, direction: 'increase', fetchedOn: null },
    }))
    expect(text.progress).toContain('还没有可以对照的当前数字')
    expect(text.suggestion).toContain('不会自己编一个数')
  })

  it('客户名下没挂上的广告不算进来，等点头的只是建议', () => {
    const text = describePrescriptionCheck(facts({
      adDrafts: { waiting: 1, active: 0, rejected: 0, other: 0 },
      workOrders: { doing: 0, published: 0, stuck: 2, other: 0 },
    }))
    expect(text.progress).toContain('等你点头 1 条')
    expect(text.progress).toContain('没有花钱')
    expect(text.suggestion).toContain('不会自己打开')
    expect(text.suggestion).toContain('不会自动重做')
    expect(text.suggestion).not.toContain('已批准一份新')
  })

  it('挂了目标但阶段没读到时，说读不到，不说没有阶段', () => {
    const text = describePrescriptionCheck(facts({
      initiativesKnown: false,
      initiativeCount: 0,
      goalActions: null,
      campaigns: null,
    }))
    expect(text.progress).toContain('目标下的阶段这周没读出来，不把没读到当成没有。')
    expect(text.progress).not.toContain('0 条阶段')
    expect(text.progress).not.toContain('这些阶段上还没有待办')
    expect(text.suggestion).not.toContain('目标下还没有阶段')
  })

  it('没有目标时，不拿全部工单来凑', () => {
    const text = describePrescriptionCheck(facts({
      goalTitle: null,
      goalLinked: false,
      initiativesKnown: false,
      metric: null,
      workOrders: null,
      goalActions: null,
      campaigns: null,
    }))
    expect(text.progress).toContain('没有拿这个客户的全部工单来凑')
    expect(text.progress).toContain('没有目标数字可以对')
  })
})

describe('个人 IP 复盘建议', () => {
  const personal = {
    postsThisWeek: 6,
    engagementBaseline: 0.03,
    recentEngagement: [0.04, 0.035],
    boostedCost: 1,
    bestOrganicCost: 1,
    dmConversations: 4,
    bookings: 2,
  }

  it('内容少于 5 条不下结论，其他三条都不出', () => {
    const lines = personalIpSuggestions({
      ...personal, postsThisWeek: 4, recentEngagement: [0.01, 0.01], boostedCost: 9, dmConversations: 50, bookings: 0,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('不到 5 条')
    expect(lines[0]).toContain('先不下结论')
  })

  it('本周发了几条没读到，也不下结论', () => {
    expect(personalIpSuggestions({ ...personal, postsThisWeek: null })[0]).toContain('没读到')
  })

  it('连续两周互动率低于起点，建议换选题或开头', () => {
    const lines = personalIpSuggestions({ ...personal, recentEngagement: [0.02, 0.025] })
    expect(lines.join('')).toContain('换选题或换开头')
    expect(lines.join('')).toContain('不会自动')
  })

  it('只有一周低于起点，或有一周没读到，不出这条', () => {
    expect(personalIpSuggestions({ ...personal, recentEngagement: [0.02, 0.04] })).toEqual([])
    expect(personalIpSuggestions({ ...personal, recentEngagement: [0.02, null] })).toEqual([])
  })

  it('加钱推的帖子成本超过最好自然帖的 2 倍才建议停；正好 2 倍不算', () => {
    expect(personalIpSuggestions({ ...personal, boostedCost: 2.01 }).join('')).toContain('停掉')
    expect(personalIpSuggestions({ ...personal, boostedCost: 2 })).toEqual([])
  })

  it('私信多、预约少，建议改话术或落地页', () => {
    const lines = personalIpSuggestions({ ...personal, dmConversations: 20, bookings: 1 })
    expect(lines.join('')).toContain('改私信话术或落地页')
    expect(personalIpSuggestions({ ...personal, dmConversations: 20, bookings: 5 })).toEqual([])
    expect(personalIpSuggestions({ ...personal, dmConversations: 9, bookings: 0 })).toEqual([])
  })

  it('普通方案的复盘文字不变；个人 IP 的建议排在前面', () => {
    const plain = describePrescriptionCheck(facts())
    expect(plain.suggestion).not.toContain('选题')
    const withPersonal = describePrescriptionCheck(facts({
      personalIp: { ...personal, recentEngagement: [0.01, 0.01] },
    }))
    expect(withPersonal.suggestion.startsWith('互动率连续两周低于开方时的起点')).toBe(true)
  })
})
