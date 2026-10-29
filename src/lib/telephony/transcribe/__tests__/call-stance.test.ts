/**
 * 客人在电话里说「现在还没准备好 / 不感兴趣」→ 通话分析记成事实 → 写到 CRM 触点上。
 * 真实案例：PM 2026-10-29 Gavin Hall，37 秒，"I'm not ready for that. I'll talk to you another day."
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeTouchpointDb } from '@/lib/crm/__tests__/fake-touchpoint-db'

const holder = vi.hoisted(() => ({ db: null as null | { from: () => unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => holder.db!.from() } }))

import { ANALYSIS_JSON_SCHEMA, FACT_KEYS, verifyFacts, type RawFact } from '../analysis-schema'
import { parseAnalysisJson } from '../vendors'
import { callStanceFromFacts, mirrorReviewToTouchpoints, writeCallStance } from '../call-stance'

const GAVIN = "声道1：Hi Gavin, it's Amy from the tour company, about the China tour.\n声道2：I'm not ready for that. I'll talk to you another day."
const notReady = (over: Partial<RawFact> = {}): RawFact => ({
  key: 'not_ready_now', value: '客人说现在还没准备好，改天再谈', quote: "I'm not ready for that. I'll talk to you another day.", confidence: 0.9, speaker: 'customer', ...over,
})

describe('分析：两个新的表态事实', () => {
  it('事实种类和 JSON Schema 里都有 not_ready_now / not_interested', () => {
    expect(FACT_KEYS).toContain('not_ready_now')
    expect(FACT_KEYS).toContain('not_interested')
    const keyEnum = ANALYSIS_JSON_SCHEMA.properties.facts.items.properties.key.enum
    expect(keyEnum).toContain('not_ready_now')
    expect(keyEnum).toContain('not_interested')
  })

  it('模型返回的 not_interested 事实能通过解析（不被当成不认识的种类丢掉）', () => {
    const raw = parseAnalysisJson(JSON.stringify({
      summary: '客人表示不感兴趣', language: 'en', inquiries: [],
      facts: [{ key: 'not_interested', value: '不感兴趣', quote: "I'm not interested, thanks", confidence: 0.9, speaker: 'customer' }],
    }))
    expect(raw.facts.map((f) => f.key)).toEqual(['not_interested'])
  })

  it('Gavin 的原话在转写里 → 保留', () => {
    const v = verifyFacts({ summary: '客人表示尚未准备好，改日再谈', language: 'en', facts: [notReady()] }, GAVIN)
    expect(v.facts.map((f) => f.key)).toEqual(['not_ready_now'])
  })

  it('原话在转写里找不到（模型编的）→ 丢掉', () => {
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: 'maybe next year, call me in March' })] }, GAVIN)
    expect(v.facts).toHaveLength(0)
    expect(v.droppedFacts).toBe(1)
  })

  it('问句（员工问「还没准备好吗？」）不算表态', () => {
    const t = "声道1：Are you not ready for that yet? 声道2：Yes I am, tell me more."
    const v = verifyFacts({ summary: '', language: 'en', facts: [notReady({ quote: 'Are you not ready for that yet?', speaker: 'unclear' })] }, t)
    expect(v.facts).toHaveLength(0)
  })
})

describe('事实 → 表态', () => {
  it('客人说的 not_ready_now → not_now；not_interested 优先', () => {
    expect(callStanceFromFacts([notReady()])).toBe('not_now')
    expect(callStanceFromFacts([notReady(), notReady({ key: 'not_interested' })])).toBe('not_interested')
  })
  it('员工说的 / 分不清谁说的 / 没写说话人 → 不算', () => {
    expect(callStanceFromFacts([notReady({ speaker: 'employee' })])).toBeNull()
    expect(callStanceFromFacts([notReady({ speaker: 'unclear' })])).toBeNull()
    expect(callStanceFromFacts([notReady({ speaker: undefined })])).toBeNull()
    expect(callStanceFromFacts([])).toBeNull()
  })
})

describe('写到 CRM 触点', () => {
  let fake: ReturnType<typeof makeFakeTouchpointDb>
  const row = (metadata: Record<string, unknown>) => [{ id: 'tp-1', client_id: 'c-1', metadata }]
  const write = () => writeCallStance({ touchpointId: 'tp-1', clientId: 'c-1', analysisId: 'an-1', stance: 'not_now' })

  beforeEach(() => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'pending_review' }))
    holder.db = fake
  })

  it('触点挂的是这份分析 → 写上 call_stance，原有键保留', async () => {
    expect(await write()).toBe('written')
    expect(fake.rows[0].metadata).toEqual({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'pending_review', call_stance: 'not_now' })
  })

  it('分析已被驳回 → 不写', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1', call_analysis_review: 'rejected' }))
    holder.db = fake
    expect(await write()).toBe('skipped')
    expect(fake.updates).toHaveLength(0)
  })

  it('触点挂的是另一份分析 → 不写', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-OTHER' }))
    holder.db = fake
    expect(await write()).toBe('skipped')
    expect(fake.updates).toHaveLength(0)
  })

  it('写的同时有人改了触点 → 重试一次，两边的改动都在', async () => {
    fake = makeFakeTouchpointDb(row({ outcome: 'spoke', call_analysis_id: 'an-1' }), { interfere: 1 })
    holder.db = fake
    expect(await write()).toBe('written')
    expect(fake.rows[0].metadata).toMatchObject({ call_stance: 'not_now', other_writer: 1 })
  })
})

describe('人工复核状态同步到触点', () => {
  it('驳回 → 挂这份分析的触点标上 rejected；别的分析的触点不动', async () => {
    const fake = makeFakeTouchpointDb([
      { id: 'tp-1', client_id: 'c-1', metadata: { call_analysis_id: 'an-1', call_analysis_review: 'pending_review', call_stance: 'not_now' } },
      { id: 'tp-2', client_id: 'c-1', metadata: { call_analysis_id: 'an-2', call_analysis_review: 'pending_review' } },
      { id: 'tp-3', client_id: 'c-OTHER', metadata: { call_analysis_id: 'an-1', call_analysis_review: 'pending_review' } },
    ])
    holder.db = fake
    await mirrorReviewToTouchpoints({ clientId: 'c-1', analysisId: 'an-1', review: 'rejected' })
    expect(fake.rows[0].metadata.call_analysis_review).toBe('rejected')
    expect(fake.rows[1].metadata.call_analysis_review).toBe('pending_review')
    expect(fake.rows[2].metadata.call_analysis_review).toBe('pending_review')
  })

  it('找触点失败 → 只记日志，不抛错（复核本身已成功）', async () => {
    holder.db = makeFakeTouchpointDb([], { failList: true })
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(mirrorReviewToTouchpoints({ clientId: 'c-1', analysisId: 'an-1', review: 'rejected' })).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
