import { describe, it, expect } from 'vitest'
import {
  parseCrmStageSignalsConfig,
  planLeadStageEvents,
  readCapiSendKinds,
  leadStageSourceRef,
  bookingStageKey,
} from '../crm-stage-signals'

const DAY = 86_400_000
const NOW = new Date('2026-11-10T00:00:00Z')
const WINDOW = 7 * DAY - 3_600_000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString()

const LEAD_A = '1189338710082692'
const LEAD_B = '2397056934398420'

const STAGES = [
  { eventName: 'Quoted', stageKeys: ['quoted'], bookingMilestone: null },
  { eventName: 'Deposit Paid', stageKeys: ['deposit_paid', 'paid_full'], bookingMilestone: null },
]
const STAGES_BOOKING = [
  { eventName: 'Quoted', stageKeys: ['quoted'], bookingMilestone: null },
  { eventName: 'Deposit Paid', stageKeys: [], bookingMilestone: 'deposit' as const },
]

function plan(over: Partial<Parameters<typeof planLeadStageEvents>[0]> = {}) {
  return planLeadStageEvents({
    config: { stages: STAGES, initialEventName: null },
    leads: [],
    changes: [],
    now: NOW,
    windowMs: WINDOW,
    ...over,
  })
}

describe('parseCrmStageSignalsConfig', () => {
  const good = {
    crm_stage_signals: {
      enabled: true,
      mode: 'live',
      dataset_id: '123456789012345',
      lead_event_source: 'Magic Engine',
      initial_event_name: 'Lead',
      stages: [
        { event_name: 'Quoted', stage_keys: ['quoted'] },
        { event_name: 'Deposit Paid', stage_keys: ['deposit_paid'] },
      ],
    },
  }

  it('合法配置原样读出', () => {
    const c = parseCrmStageSignalsConfig(good)
    expect(c).toMatchObject({ enabled: true, mode: 'live', datasetId: '123456789012345', initialEventName: 'Lead' })
    expect(c?.stages.map((s) => s.eventName)).toEqual(['Quoted', 'Deposit Paid'])
  })

  it('没写 mode = 试运行（只有明确写 live 才真发）', () => {
    const c = parseCrmStageSignalsConfig({ crm_stage_signals: { ...good.crm_stage_signals, mode: 'LIVE' } })
    expect(c?.mode).toBe('dry_run')
  })

  it('enabled 不是 true 就不算开（字符串 "true" 也不算）', () => {
    expect(parseCrmStageSignalsConfig({ crm_stage_signals: { ...good.crm_stage_signals, enabled: 'true' } })?.enabled).toBe(false)
  })

  it.each([
    ['没有 crm_stage_signals', {}],
    ['stages 不是数组', { crm_stage_signals: { ...good.crm_stage_signals, stages: 'quoted' } }],
    ['stages 为空', { crm_stage_signals: { ...good.crm_stage_signals, stages: [] } }],
    ['某档没有 stage_keys', { crm_stage_signals: { ...good.crm_stage_signals, stages: [{ event_name: 'Quoted', stage_keys: [] }] } }],
    ['阶段名重复', { crm_stage_signals: { ...good.crm_stage_signals, stages: [{ event_name: 'Q', stage_keys: ['a'] }, { event_name: 'Q', stage_keys: ['b'] }] } }],
    ['第一档名字跟后面某档重名', { crm_stage_signals: { ...good.crm_stage_signals, initial_event_name: 'Quoted' } }],
  ])('格式不对 → 整体不生效：%s', (_label, cfg) => {
    expect(parseCrmStageSignalsConfig(cfg)).toBeNull()
  })

  it('某一档只读订单里程碑、不列客人阶段 → 合法', () => {
    const c = parseCrmStageSignalsConfig({
      crm_stage_signals: { ...good.crm_stage_signals, stages: [{ event_name: 'Deposit Paid', booking_milestone: 'deposit' }] },
    })
    expect(c?.stages).toEqual([{ eventName: 'Deposit Paid', stageKeys: [], bookingMilestone: 'deposit' }])
  })

  it('客人阶段的 key 用了 booking: 开头（会跟订单里程碑的内部名字撞）→ 整体不生效', () => {
    expect(
      parseCrmStageSignalsConfig({
        crm_stage_signals: { ...good.crm_stage_signals, stages: [{ event_name: 'X', stage_keys: ['booking:deposit'] }] },
      }),
    ).toBeNull()
  })

  it('订单里程碑写了不认识的值 → 整体不生效（不猜成没写）', () => {
    expect(
      parseCrmStageSignalsConfig({
        crm_stage_signals: { ...good.crm_stage_signals, stages: [{ event_name: 'X', stage_keys: ['quoted'], booking_milestone: 'refund' }] },
      }),
    ).toBeNull()
  })

  it('数据集编号格式不对 → 记为没配（发送时 fail-closed）', () => {
    expect(parseCrmStageSignalsConfig({ crm_stage_signals: { ...good.crm_stage_signals, dataset_id: 'abc' } })?.datasetId).toBeNull()
  })
})

describe('readCapiSendKinds', () => {
  it('没写 = 不限制（老客户行为不变）', () => {
    expect(readCapiSendKinds({})).toBeNull()
    expect(readCapiSendKinds(null)).toBeNull()
  })
  it('写了就只认名单里的', () => {
    expect(readCapiSendKinds({ capi_send_kinds: ['purchase', 'lead_stage', 'bogus'] })).toEqual(['purchase', 'lead_stage'])
  })
  it('写了但不是数组 = 一类都不许发（fail-closed）', () => {
    expect(readCapiSendKinds({ capi_send_kinds: 'purchase' })).toEqual([])
  })
})

describe('planLeadStageEvents', () => {
  it('7 天内走到「已报价」→ 报一条 Quoted，挂在之前那条表单线索上', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(20) }],
      changes: [{ contactId: 'c1', toStage: 'quoted', at: ago(2) }],
    })
    expect(r.events).toEqual([
      expect.objectContaining({ contactId: 'c1', leadId: LEAD_A, eventName: 'Quoted', occurredAt: ago(2), sourceRef: `${LEAD_A}:Quoted` }),
    ])
  })

  it('直接跳到「已付定金」→ 前面的 Quoted 一起补上，且 Quoted 排在前面', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(10) }],
      changes: [{ contactId: 'c1', toStage: 'deposit_paid', at: ago(1) }],
    })
    expect(r.events.map((e) => e.eventName)).toEqual(['Quoted', 'Deposit Paid'])
    expect(r.events.every((e) => e.occurredAt === ago(1))).toBe(true)
  })

  it('配置里列的后续阶段（付全款）也算到过定金这一档', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(10) }],
      changes: [{ contactId: 'c1', toStage: 'paid_full', at: ago(1) }],
    })
    expect(r.events.map((e) => e.eventName)).toEqual(['Quoted', 'Deposit Paid'])
  })

  it('到达时间取最早那次：8 天前报过价、昨天又改回已报价 → 不再报', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(30) }],
      changes: [
        { contactId: 'c1', toStage: 'quoted', at: ago(8) },
        { contactId: 'c1', toStage: 'quoted', at: ago(1) },
      ],
    })
    expect(r.events).toEqual([])
  })

  it('8 天前报价、今天付定金 → 只报定金（Quoted 早已超窗，补也补不回）', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(30) }],
      changes: [
        { contactId: 'c1', toStage: 'quoted', at: ago(8) },
        { contactId: 'c1', toStage: 'deposit_paid', at: ago(0.5) },
      ],
    })
    expect(r.events.map((e) => e.eventName)).toEqual(['Deposit Paid'])
  })

  it('没有表单线索的客人（电话/官网进来）→ 不报，也不算跳过', () => {
    const r = plan({ changes: [{ contactId: 'c9', toStage: 'quoted', at: ago(1) }] })
    expect(r.events).toEqual([])
    expect(r.skipped).toEqual([{ contactId: 'c9', eventName: 'Quoted', reason: 'stage_before_any_lead' }])
  })

  it('报价发生在表单之前（客人后来又填了表）→ 跳过并记原因，不挂到之后的线索上', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(1) }],
      changes: [{ contactId: 'c1', toStage: 'quoted', at: ago(3) }],
    })
    expect(r.events).toEqual([])
    expect(r.skipped[0]?.reason).toBe('stage_before_any_lead')
  })

  it('填过两次表 → 挂在「到达之前最近的那条」', () => {
    const r = plan({
      leads: [
        { contactId: 'c1', leadId: LEAD_A, createdAt: ago(40) },
        { contactId: 'c1', leadId: LEAD_B, createdAt: ago(5) },
      ],
      changes: [{ contactId: 'c1', toStage: 'quoted', at: ago(2) }],
    })
    expect(r.events[0]?.leadId).toBe(LEAD_B)
  })

  it('阶段时间跟线索时间同一秒 → 事件时间往后挪 1 秒（Meta：早于线索的事件可能被丢）', () => {
    const t = ago(2)
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: t }],
      changes: [{ contactId: 'c1', toStage: 'quoted', at: t }],
    })
    expect(Date.parse(r.events[0].occurredAt) - Date.parse(t)).toBe(1000)
  })

  it('配了第一档 → 7 天内新进来的表单线索各报一条，窗外的不报', () => {
    const r = plan({
      config: { stages: STAGES, initialEventName: 'Lead' },
      leads: [
        { contactId: 'c1', leadId: LEAD_A, createdAt: ago(3) },
        { contactId: 'c2', leadId: LEAD_B, createdAt: ago(9) },
      ],
    })
    expect(r.events).toEqual([expect.objectContaining({ leadId: LEAD_A, eventName: 'Lead', sourceRef: leadStageSourceRef(LEAD_A, 'Lead') })])
    // 第一档也比线索时间晚 1 秒（Meta：事件时间要晚于线索生成时间）
    expect(Date.parse(r.events[0].occurredAt) - Date.parse(ago(3))).toBe(1000)
  })

  it('线索编号格式不对（不是 15–17 位数字）→ 当作没有这条线索', () => {
    const r = plan({
      config: { stages: STAGES, initialEventName: 'Lead' },
      leads: [{ contactId: 'c1', leadId: 'l:abc', createdAt: ago(3) }],
      changes: [{ contactId: 'c1', toStage: 'quoted', at: ago(1) }],
    })
    expect(r.events).toEqual([])
  })

  it('配置里没列的阶段（如「已联系」）不报', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(5) }],
      changes: [{ contactId: 'c1', toStage: 'contacted', at: ago(1) }],
    })
    expect(r.events).toEqual([])
  })

  it('订单定金被标成已收 → 报 Deposit Paid，并补上 Quoted；客人阶段上的「已付定金」不再算', () => {
    const r = plan({
      config: { stages: STAGES_BOOKING, initialEventName: null },
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(10) }],
      changes: [{ contactId: 'c1', toStage: bookingStageKey('deposit'), at: ago(1) }],
    })
    expect(r.events.map((e) => e.eventName)).toEqual(['Quoted', 'Deposit Paid'])
    const stageOnly = plan({
      config: { stages: STAGES_BOOKING, initialEventName: null },
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(10) }],
      changes: [{ contactId: 'c1', toStage: 'deposit_paid', at: ago(1) }],
    })
    expect(stageOnly.events).toEqual([])
  })

  it('一档同时认客人阶段和订单里程碑 → 取两边最早的那一刻', () => {
    const both = [{ eventName: 'Deposit Paid', stageKeys: ['deposit_paid'], bookingMilestone: 'deposit' as const }]
    const r = plan({
      config: { stages: both, initialEventName: null },
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(10) }],
      changes: [
        { contactId: 'c1', toStage: 'deposit_paid', at: ago(1) },
        { contactId: 'c1', toStage: bookingStageKey('deposit'), at: ago(3) },
      ],
    })
    expect(r.events).toEqual([expect.objectContaining({ eventName: 'Deposit Paid', occurredAt: ago(3) })])
  })

  it('同一条线索同一档只出一条（幂等键唯一）', () => {
    const r = plan({
      leads: [{ contactId: 'c1', leadId: LEAD_A, createdAt: ago(5) }],
      changes: [
        { contactId: 'c1', toStage: 'deposit_paid', at: ago(1) },
        { contactId: 'c1', toStage: 'paid_full', at: ago(0.5) },
      ],
    })
    const refs = r.events.map((e) => e.sourceRef)
    expect(new Set(refs).size).toBe(refs.length)
  })
})
