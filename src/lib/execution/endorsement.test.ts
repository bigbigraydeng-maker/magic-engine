import { describe, it, expect } from 'vitest'
import { deriveEndorsement, ageInDays } from './endorsement'
import type { EndorsementInput } from './endorsement'

const NOW = new Date('2026-08-06T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const CLIENT_ID = 'oztop'

function input(over: Partial<EndorsementInput> = {}): EndorsementInput {
  return {
    source: 'zhuge',
    clientId: CLIENT_ID,
    createdAt: daysAgo(1),
    prescriptionId: null,
    prescription: null,
    marketingPlanId: null,
    marketingPlan: null,
    ...over,
  }
}

const approvedPrescription = (ageDays: number) => ({
  client_id: CLIENT_ID,
  status: 'approved',
  approved_at: daysAgo(ageDays),
  generated_at: daysAgo(ageDays + 1),
})

describe('deriveEndorsement —— source 的 7 个取值每个都有明确归宿', () => {
  it('diagnostic：必然挂方案（表约束强制），方案有效 → current_prescription', () => {
    const e = deriveEndorsement(
      input({ source: 'diagnostic', prescriptionId: 'p1', prescription: approvedPrescription(3) }),
      NOW,
    )
    expect(e.kind).toBe('current_prescription')
    if (e.kind === 'current_prescription') expect(Math.round(e.ageDays)).toBe(3)
  })

  it('marketing_plan：挂的是计划不是方案（表约束不允许它带 prescription_id）', () => {
    const e = deriveEndorsement(
      input({
        source: 'marketing_plan',
        prescriptionId: null,
        marketingPlanId: 'm1',
        marketingPlan: { client_id: CLIENT_ID, status: 'approved', approved_at: daysAgo(10), end_date: null },
      }),
      NOW,
    )
    expect(e.kind).toBe('current_marketing_plan')
  })

  it('zhuge：没锚点时算「近期分析产物」（诸葛亮当天/本周的卡）', () => {
    const e = deriveEndorsement(input({ source: 'zhuge', createdAt: daysAgo(2) }), NOW)
    expect(e.kind).toBe('recent_analysis')
    if (e.kind === 'recent_analysis') expect(Math.round(e.ageDays)).toBe(2)
  })

  it('proactive_signal：同上，也是某一轮分析吐出来的', () => {
    expect(deriveEndorsement(input({ source: 'proactive_signal' }), NOW).kind).toBe('recent_analysis')
  })

  it('luban：同上', () => {
    expect(deriveEndorsement(input({ source: 'luban' }), NOW).kind).toBe('recent_analysis')
  })

  it('🔴 fde：人手加的卡不算「近期分析」—— 它可能是三个月前顺手记的一笔', () => {
    const e = deriveEndorsement(input({ source: 'fde', createdAt: daysAgo(90) }), NOW)
    expect(e.kind).toBe('unendorsed')
    if (e.kind === 'unendorsed') expect(Math.round(e.ageDays)).toBe(90)
  })

  it('🔴 fde_manual：同上。人要机器去跑，得走方案那根锚', () => {
    expect(deriveEndorsement(input({ source: 'fde_manual' }), NOW).kind).toBe('unendorsed')
  })

  it('认不出的来源落到保守那一边，不是放行', () => {
    expect(deriveEndorsement(input({ source: 'something_new' }), NOW).kind).toBe('unendorsed')
  })
})

describe('deriveEndorsement —— 方案这根锚必须看 status，不能只看有没有 id', () => {
  it('🔴 superseded → stale。只看 id 有没有值的话，这条分支永远不触发 = 主安全闸是死代码', () => {
    const e = deriveEndorsement(
      input({
        source: 'diagnostic',
        prescriptionId: 'p1',
        prescription: { client_id: CLIENT_ID, status: 'superseded', approved_at: daysAgo(2), generated_at: null },
      }),
      NOW,
    )
    expect(e.kind).toBe('stale_prescription')
  })

  it('🔴 draft 也算 stale —— 还没批的方案不能当授权用（草稿一写出来就等于放行）', () => {
    const e = deriveEndorsement(
      input({
        source: 'diagnostic',
        prescriptionId: 'p1',
        prescription: { client_id: CLIENT_ID, status: 'draft', approved_at: null, generated_at: daysAgo(1) },
      }),
      NOW,
    )
    expect(e.kind).toBe('stale_prescription')
  })

  it('rejected / generating / failed 一律 stale', () => {
    for (const status of ['rejected', 'generating', 'failed']) {
      const e = deriveEndorsement(
        input({
          source: 'diagnostic',
          prescriptionId: 'p1',
          prescription: { client_id: CLIENT_ID, status, approved_at: null, generated_at: daysAgo(1) },
        }),
        NOW,
      )
      expect(e.kind, status).toBe('stale_prescription')
    }
  })

  it('🔴 方案行查不回来（被删了 / join 没命中）→ 当没背书，不当有背书', () => {
    const e = deriveEndorsement(
      input({ source: 'diagnostic', prescriptionId: 'p1', prescription: null }),
      NOW,
    )
    expect(e.kind).toBe('unendorsed')
  })

  it('🔴 跨客户错配：查回来的方案是approved且新鲜，但 client_id 对不上 → 当没背书，不能借别的客户的方案背书这条', () => {
    const e = deriveEndorsement(
      input({
        source: 'diagnostic',
        clientId: CLIENT_ID,
        prescriptionId: 'p1',
        prescription: { client_id: 'some-other-client', status: 'approved', approved_at: daysAgo(1), generated_at: null },
      }),
      NOW,
    )
    expect(e.kind).toBe('unendorsed')
  })

  it('批准时刻缺失时退回生成时刻算年龄，两个都没有就当无穷老', () => {
    const withGenerated = deriveEndorsement(
      input({
        source: 'diagnostic',
        prescriptionId: 'p1',
        prescription: { client_id: CLIENT_ID, status: 'approved', approved_at: null, generated_at: daysAgo(5) },
      }),
      NOW,
    )
    expect(withGenerated.kind === 'current_prescription' && Math.round(withGenerated.ageDays)).toBe(5)

    const neither = deriveEndorsement(
      input({
        source: 'diagnostic',
        prescriptionId: 'p1',
        prescription: { client_id: CLIENT_ID, status: 'approved', approved_at: null, generated_at: null },
      }),
      NOW,
    )
    expect(neither.kind === 'current_prescription' && neither.ageDays).toBe(Infinity)
  })

  it('🔴 方案优先于营销计划 —— 两个都有值时不能各判各的', () => {
    const e = deriveEndorsement(
      input({
        source: 'zhuge',
        prescriptionId: 'p1',
        prescription: { client_id: CLIENT_ID, status: 'superseded', approved_at: daysAgo(1), generated_at: null },
        marketingPlanId: 'm1',
        marketingPlan: { client_id: CLIENT_ID, status: 'approved', approved_at: daysAgo(1), end_date: null },
      }),
      NOW,
    )
    expect(e.kind).toBe('stale_prescription')
  })
})

describe('deriveEndorsement —— 营销计划这根锚', () => {
  const planItem = (plan: {
    client_id: string
    status: string
    approved_at: string | null
    end_date: string | null
  }) =>
    deriveEndorsement(
      input({ source: 'marketing_plan', marketingPlanId: 'm1', marketingPlan: plan }),
      NOW,
    )

  it('🔴 已结束（end_date 过了）→ stale，这一期做完了不补作业', () => {
    const e = planItem({ client_id: CLIENT_ID, status: 'approved', approved_at: daysAgo(30), end_date: daysAgo(2).slice(0, 10) })
    expect(e.kind).toBe('stale_marketing_plan')
  })

  it('还在期内 → current', () => {
    const future = new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10)
    expect(planItem({ client_id: CLIENT_ID, status: 'approved', approved_at: daysAgo(5), end_date: future }).kind).toBe(
      'current_marketing_plan',
    )
  })

  it('draft / completed / archived 一律 stale', () => {
    for (const status of ['draft', 'completed', 'archived']) {
      expect(planItem({ client_id: CLIENT_ID, status, approved_at: daysAgo(1), end_date: null }).kind, status).toBe(
        'stale_marketing_plan',
      )
    }
  })

  it('计划行查不回来 → 当没背书', () => {
    const e = deriveEndorsement(
      input({ source: 'marketing_plan', marketingPlanId: 'm1', marketingPlan: null }),
      NOW,
    )
    expect(e.kind).toBe('unendorsed')
  })

  it('🔴 跨客户错配：查回来的计划是approved且在期内，但 client_id 对不上 → 当没背书', () => {
    const future = new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10)
    const e = deriveEndorsement(
      input({
        source: 'marketing_plan',
        clientId: CLIENT_ID,
        marketingPlanId: 'm1',
        marketingPlan: { client_id: 'some-other-client', status: 'approved', approved_at: daysAgo(5), end_date: future },
      }),
      NOW,
    )
    expect(e.kind).toBe('unendorsed')
  })
})

describe('ageInDays', () => {
  it('空值和脏数据一律当无穷老 —— 不能因为时间戳坏了就放行', () => {
    expect(ageInDays(null, NOW)).toBe(Infinity)
    expect(ageInDays('not-a-date', NOW)).toBe(Infinity)
  })

  it('未来时间不返回负数（负数会绕过所有「超过 N 天」的判断）', () => {
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString()
    expect(ageInDays(tomorrow, NOW)).toBe(0)
  })
})
