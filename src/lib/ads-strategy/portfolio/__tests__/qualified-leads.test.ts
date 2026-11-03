/**
 * 成绩单「合格客人」（修复方案第 1 刀 ③；设计 docs/specs/2026-11-03-ads-scorecard-qualified-column-v0.md）。
 *
 * 考题：
 *  - 合格 = 现在或曾经到过登记的合格阶段；谁标的看第一次进入合格阶段那条记录（认不出的不兜底算人）；
 *  - 没合格的才分「跟进过没合格 / 没人跟进 / 观察中」，跟进判据复用 CRM 的 isHumanFollowup（群发不算）；
 *  - 停投组照样列；整个系列分钱的按系列合计；对不上组的合格客人单独数；
 *  - 设置里登记了、但客户已删的阶段忽略并列出来。
 */
import { describe, expect, it } from 'vitest'
import {
  computeQualifiedBlock,
  QUALIFIED_OBSERVE_DAYS,
  type QualifiedComputeArgs,
  type QualifiedContact,
  type QualifiedUnitRef,
} from '../qualified-leads'

const DATE = '2026-11-01'
const END = Date.parse('2026-11-01T10:59:59.999Z') // 新西兰 11-01 的最后一刻
const DAY = 86_400_000
const at = (daysBeforeEnd: number) => new Date(END - daysBeforeEnd * DAY).toISOString()
const QUALIFIED = ['quoted', 'deposit_paid', 'paid_full', 'traveling_soon', 'trip_completed']
const KNOWN = ['new', 'contacted', 'quoted', 'deposit_paid', 'paid_full', 'no_response', 'deferred', 'not_interested', 'traveling_soon', 'trip_completed', 'not_enquiry']

function contact(id: string, over: Partial<QualifiedContact> = {}): QualifiedContact {
  return { id, adsetId: 'A', createdAt: at(25), stage: 'new', events: [], touches: [], ...over }
}

const UNITS: QualifiedUnitRef[] = [
  { id: 'A', name: '组A', level: 'adset', adsetIds: ['A'], spentLast7d: true },
  { id: 'cbo', name: '系列X', level: 'campaign', adsetIds: ['K1', 'K2'], spentLast7d: true },
]

function run(contacts: QualifiedContact[], over: Partial<QualifiedComputeArgs> = {}) {
  return computeQualifiedBlock({
    date: DATE, windowStart: '2026-10-03', endUtcMs: END, observeDays: QUALIFIED_OBSERVE_DAYS,
    qualifiedStageKeys: QUALIFIED, knownStageKeys: KNOWN, contacts, units: UNITS, ...over,
  })
}
const rowOf = (b: ReturnType<typeof run>, id: string) => b.rows.find(r => r.id === id)!

const phoneCall = (daysBeforeEnd: number) => ({ channel: 'phone', direction: 'outbound', occurredAt: at(daysBeforeEnd), source: 'twilio', metadata: { answered: true } })
const massMail = (daysBeforeEnd: number) => ({ channel: 'email', direction: 'outbound', occurredAt: at(daysBeforeEnd), source: 'mailchimp', metadata: null })

describe('合格：现在或曾经到过合格阶段', () => {
  it('现在在「已报价」、但没有进入记录 → 合格，来源认不出', () => {
    const b = run([contact('c1', { stage: 'quoted' })])
    expect(rowOf(b, 'A').qualified).toEqual({ total: 1, human: 0, system: 0, ai: 0, unknown: 1 })
  })

  it('报过价、后来变「无下文」→ 照样算合格；谁标的看第一次进入合格阶段那条', () => {
    const b = run([contact('c1', { stage: 'no_response', events: [
      { toStage: 'no_response', changedBy: 'ai:conversation-read', createdAt: at(2) },
      { toStage: 'deposit_paid', changedBy: 'system:qualified-buyer', createdAt: at(5) },
      { toStage: 'quoted', changedBy: 'human:sales@example.com', createdAt: at(10) },
    ] })])
    expect(rowOf(b, 'A').qualified).toEqual({ total: 1, human: 1, system: 0, ai: 0, unknown: 0 })
  })

  it('四类写入者各自归位；agent 代写的「PM-… via claude」归来源认不出，不算人', () => {
    const q = (id: string, by: string) => contact(id, { stage: 'quoted', events: [{ toStage: 'quoted', changedBy: by, createdAt: at(3) }] })
    const b = run([q('c1', 'human:a@x.com'), q('c2', 'a@x.com'), q('c3', 'system:quote-email-sent'), q('c4', 'ai:conversation-read'), q('c5', 'PM-2026-10-12 via claude (74号 邮箱核对)')])
    expect(rowOf(b, 'A').qualified).toEqual({ total: 5, human: 2, system: 1, ai: 1, unknown: 1 })
  })

  it('没登记的阶段（「已联系」）不算合格', () => {
    const b = run([contact('c1', { stage: 'contacted', events: [{ toStage: 'contacted', changedBy: 'human:a@x.com', createdAt: at(20) }] })])
    expect(rowOf(b, 'A').qualified.total).toBe(0)
  })
})

describe('没合格的：跟进过没合格 / 没人跟进 / 观察中', () => {
  it('从没被跟进 → 没人跟进；只收过群发邮件也算没人跟进', () => {
    const b = run([contact('c1'), contact('c2', { touches: [massMail(20)] })])
    expect(rowOf(b, 'A')).toMatchObject({ leads: 2, noFollowup: 2, observing: 0, followedNotQualified: 0 })
  })

  it('打过电话、第一次跟进满 14 天 → 跟进过没合格；不满 14 天 → 观察中', () => {
    const b = run([contact('c1', { touches: [phoneCall(20)] }), contact('c2', { touches: [phoneCall(5)] })])
    expect(rowOf(b, 'A')).toMatchObject({ followedNotQualified: 1, observing: 1, noFollowup: 0 })
  })

  it('人写的阶段记录也算跟进过；AI 写的不算；客人进来之前的往来不算', () => {
    const b = run([
      contact('c1', { events: [{ toStage: 'contacted', changedBy: 'human:a@x.com', createdAt: at(20) }] }),
      contact('c2', { events: [{ toStage: 'contacted', changedBy: 'ai:conversation-read', createdAt: at(20) }] }),
      contact('c3', { createdAt: at(10), touches: [phoneCall(25)] }),
    ])
    expect(rowOf(b, 'A')).toMatchObject({ followedNotQualified: 1, noFollowup: 2 })
  })

  it('只打过没接通 / 空号的电话 → 没联系上，满 14 天也算「ME 里没跟进记录」', () => {
    const noAnswer = { channel: 'phone', direction: 'outbound', occurredAt: at(20), source: 'sheet_followup', metadata: { outcome: 'no_answer' } }
    const badNumber = { ...noAnswer, metadata: { outcome: 'bad_number' } }
    const spoke = { ...noAnswer, metadata: { outcome: 'spoke' } }
    const b = run([contact('c1', { touches: [noAnswer] }), contact('c2', { touches: [badNumber] }), contact('c3', { touches: [noAnswer, spoke] })])
    expect(rowOf(b, 'A')).toMatchObject({ noFollowup: 2, followedNotQualified: 1 })
  })

  it('窗口结束之后才发生的报价、跟进不算（回放旧日子时要跟当天一致）', () => {
    const b = run([
      // 现在的阶段已经是「已报价」，但那是窗口结束之后才标的
      contact('c1', { stage: 'quoted', events: [{ toStage: 'contacted', changedBy: 'system:new-lead', createdAt: at(10) }, { toStage: 'quoted', changedBy: 'human:a@x.com', createdAt: at(-1) }] }),
      contact('c2', { touches: [phoneCall(-2)] }),
    ])
    expect(rowOf(b, 'A')).toMatchObject({ noFollowup: 2, observing: 0 })
    expect(rowOf(b, 'A').qualified.total).toBe(0)
  })

  it('合格优先：已经合格的客人不再算进观察中', () => {
    const b = run([contact('c1', { stage: 'quoted', touches: [phoneCall(3)], events: [{ toStage: 'quoted', changedBy: 'human:a@x.com', createdAt: at(3) }] })])
    expect(rowOf(b, 'A')).toMatchObject({ leads: 1, observing: 0, noFollowup: 0, followedNotQualified: 0 })
    expect(rowOf(b, 'A').qualified.total).toBe(1)
  })
})

describe('按组归', () => {
  it('组不在快照里、但它的系列是整个系列分钱的单位 → 并进系列', () => {
    const b = run([contact('c1', { adsetId: 'K9', campaignId: 'cbo' })])
    expect(rowOf(b, 'cbo').leads).toBe(1)
    expect(b.rows.map(r => r.id)).toEqual(['cbo'])
  })

  it('整个系列分钱的组按系列合计；不在今天快照里的组单列、投放状态不明（不冒充停投）；在花钱的不标', () => {
    const b = run([
      contact('c1', { adsetId: 'K1' }), contact('c2', { adsetId: 'K2' }),
      contact('c3', { adsetId: 'OLD' }), contact('c4', { adsetId: 'A' }),
    ])
    expect(rowOf(b, 'cbo')).toMatchObject({ level: 'campaign', name: '系列X', leads: 2, stoppedLast7d: false })
    expect(rowOf(b, 'OLD')).toMatchObject({ level: 'adset', name: null, leads: 1, stoppedLast7d: null })
    expect(rowOf(b, 'A').stoppedLast7d).toBe(false)
  })

  it('在快照里、但近 7 天没花钱的组也照样列，标停投', () => {
    const b = run([contact('c1')], { units: [{ ...UNITS[0], spentLast7d: false }] })
    expect(rowOf(b, 'A')).toMatchObject({ leads: 1, stoppedLast7d: true })
  })

  it('对不上组的合格客人单独数，不出行；没合格的对不上组客人不数', () => {
    const b = run([contact('c1', { adsetId: null, stage: 'quoted' }), contact('c2', { adsetId: null })])
    expect(b.unattributedQualified).toBe(1)
    expect(b.rows).toEqual([])
  })

  it('按带来客人数从多到少排', () => {
    const b = run([contact('c1', { adsetId: 'OLD' }), contact('c2'), contact('c3')])
    expect(b.rows.map(r => r.id)).toEqual(['A', 'OLD'])
  })
})

describe('设置', () => {
  it('没设置哪些阶段算合格 → configured=false', () => {
    expect(run([contact('c1', { stage: 'quoted' })], { qualifiedStageKeys: [] }).configured).toBe(false)
  })

  it('登记了、但客户已删的阶段：忽略并列出来', () => {
    const b = run([contact('c1', { stage: 'old_stage' })], { qualifiedStageKeys: ['quoted', 'old_stage'] })
    expect(b.staleStageKeys).toEqual(['old_stage'])
    expect(rowOf(b, 'A').qualified.total).toBe(0)
  })

  it('窗口和观察天数原样写出来；不改传入的数据', () => {
    const contacts = [contact('c1', { events: [{ toStage: 'quoted', changedBy: 'a@x.com', createdAt: at(3) }, { toStage: 'deposit_paid', changedBy: 'a@x.com', createdAt: at(1) }] })]
    const before = JSON.stringify(contacts)
    const b = run(contacts)
    expect(b.window).toEqual({ start: '2026-10-03', end: DATE })
    expect(b.observeDays).toBe(14)
    expect(JSON.stringify(contacts)).toBe(before)
  })
})
