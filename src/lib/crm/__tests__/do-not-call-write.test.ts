/**
 * 「只别打电话」写的一侧（第 2 刀 2B，设计稿 v1 修订 B / C / E）。
 *
 * 钉住四件事：
 *   1. 解析器：只说电话 → `do_not_call` + `do_not_contact:false`；说不清 → 按全面拒绝 + `needs_review`
 *   2. AI 合并：规则判 `do_not_call` 时 AI 的 `do_not_contact:true` 不算数，镜像列不许被置 true
 *   3. 写触点：`do_not_call` 不写 `metadata.do_not_contact=true`，不碰镜像列
 *   4. 下游：回电不排、私信只提示不写、「别打电话」不算客人回头
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: () => ({ responses: { create } }),
}))

const touchUpserts: Record<string, unknown>[] = []
const contactPatches: Record<string, unknown>[] = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'contact_touchpoints') {
        return {
          upsert: (row: Record<string, unknown>) => {
            touchUpserts.push(row)
            return { select: () => ({ maybeSingle: async () => ({ data: { id: 'tp-1' }, error: null }) }) }
          },
        }
      }
      if (table === 'contacts') {
        return {
          update: (patch: Record<string, unknown>) => {
            contactPatches.push(patch)
            return { eq: () => ({ eq: async () => ({ error: null }) }) }
          },
        }
      }
      throw new Error(`没预料到的表：${table}`)
    },
  },
}))

import { classifyNote, mergeRefusal, parseNote, type NoteParse } from '../note-parser'
import { recordManualTouchpoint } from '../touchpoints'
import { withStructuredCallback } from '../callback-pick'
import { pickStopSignals } from '../messenger-stop-signal'
import { decideReengageClear } from '../dnc-reengage'

const PHONE_ONLY_NOTE = '7.14大瑞更新， 客户明确说了不要电话，只邮件联系'

const PARSE: NoteParse = {
  outcome: 'spoke',
  do_not_contact: false,
  travel_window: null,
  tour_interest: null,
  competitor: null,
  callback_at: null,
  summary: '聊了聊',
}

beforeEach(() => {
  create.mockReset()
  touchUpserts.length = 0
  contactPatches.length = 0
  process.env.OPENAI_API_KEY = 'test-key'
})

const record = (note: string, parsed?: NoteParse) =>
  recordManualTouchpoint({
    clientId: 'cts',
    contactId: 'c1',
    direction: 'outbound',
    note,
    occurredAt: '2026-11-09T01:00:00.000Z',
    clientRef: 'ref-1',
    parsed,
  })

const metaOf = (i = 0) => touchUpserts[i].metadata as Record<string, unknown>

describe('classifyNote 的拒绝顺序', () => {
  it('说不清 → 按全面拒绝，并标 needs_review', () => {
    expect(classifyNote('不要打电话，不要发邮件')).toEqual({
      outcome: 'do_not_contact',
      do_not_contact: true,
      refusal_scope: 'needs_review',
    })
  })
  it('全面拒绝 → do_not_contact，不带 needs_review', () => {
    expect(classifyNote('unsubscribe')).toEqual({ outcome: 'do_not_contact', do_not_contact: true })
  })
  it('只别打电话排在没接通前面', () => {
    expect(classifyNote('不要打电话 no answer').outcome).toBe('do_not_call')
  })
  it('号码是坏的仍然最优先，只别打电话不带全拦标记', () => {
    expect(classifyNote('wrong number, 不要打电话')).toEqual({ outcome: 'bad_number', do_not_contact: false })
  })
  it('回电约定优先：今天别打、周五回电 → 约了回电', () => {
    expect(classifyNote("don't call me today, call back Friday").outcome).toBe('callback_set')
  })
})

describe('AI 合并：规则判只别打电话时，AI 的「拒联」不算数', () => {
  it('mergeRefusal 忽略 AI 的 do_not_contact', () => {
    expect(mergeRefusal({ outcome: 'do_not_call', do_not_contact: false }, true)).toEqual({
      outcome: 'do_not_call',
      do_not_contact: false,
      refusal_scope: undefined,
    })
  })
  it('其余情况仍然取并集（宁可多拦）', () => {
    expect(mergeRefusal({ outcome: 'spoke', do_not_contact: false }, true).do_not_contact).toBe(true)
  })

  it('真实链路：AI 返回 do_not_contact:true → 触点不是全拦、镜像列不被置 true', async () => {
    create.mockResolvedValue({
      output_text: JSON.stringify({
        ...PARSE,
        outcome: 'do_not_contact',
        do_not_contact: true,
        mentioned_next_step: false,
        summary: '客户明确说了不要电话，只邮件联系',
      }),
    })
    const res = await record(PHONE_ONLY_NOTE)
    expect(create).toHaveBeenCalledTimes(1)
    expect(res.parsed.outcome).toBe('do_not_call')
    expect(res.parsed.do_not_contact).toBe(false)
    expect(metaOf()).toMatchObject({ outcome: 'do_not_call', do_not_contact: false })
    expect(contactPatches[0].do_not_contact).toBeUndefined()
    expect(contactPatches[0].do_not_contact_reason).toBeUndefined()
  })
})

describe('recordManualTouchpoint 写入', () => {
  it('do_not_call：channel=phone、metadata.do_not_contact=false、不写镜像列', async () => {
    await record('客人说不要打电话', { ...PARSE, outcome: 'do_not_call', do_not_contact: false })
    expect(touchUpserts[0].channel).toBe('phone')
    expect(metaOf()).toMatchObject({ outcome: 'do_not_call', do_not_contact: false })
    expect(metaOf().refusal_scope).toBeUndefined()
    expect(contactPatches[0].do_not_contact).toBeUndefined()
  })
  it('needs_review：按全面拒绝写，另带 refusal_scope，镜像列置 true', async () => {
    await record('不要打电话，不要发邮件', {
      ...PARSE,
      outcome: 'do_not_contact',
      do_not_contact: true,
      refusal_scope: 'needs_review',
    })
    expect(metaOf()).toMatchObject({ outcome: 'do_not_contact', do_not_contact: true, refusal_scope: 'needs_review' })
    expect(contactPatches[0].do_not_contact).toBe(true)
  })
  it('矛盾状态（do_not_call + 全拦）→ 按全面拒绝记，不留矛盾', async () => {
    await record('x', { ...PARSE, outcome: 'do_not_call', do_not_contact: true })
    expect(metaOf()).toMatchObject({ outcome: 'do_not_contact', do_not_contact: true })
    expect(contactPatches[0].do_not_contact).toBe(true)
  })
})

describe('下游', () => {
  it('只别打电话不排回电', () => {
    const p: NoteParse = { ...PARSE, outcome: 'do_not_call' }
    expect(withStructuredCallback(p, '2026-11-12T21:00:00.000Z')).toBe(p)
  })

  it('私信里说不要打电话 → 只提示「要不要标记只别打电话」', () => {
    const { signals } = pickStopSignals({
      messages: [{ clientId: 'c', contactId: 'p1', body: '请不要打电话给我', sentAt: '2026-11-09T00:00:00Z' }],
      dnc: new Map(),
      lastHumanTouchAt: new Map(),
    })
    expect(signals).toHaveLength(1)
    expect(signals[0].scope).toBe('phone_only')
  })
  it('已经标过只别打电话的人不再提', () => {
    const { signals } = pickStopSignals({
      messages: [{ clientId: 'c', contactId: 'p1', body: '不要打电话', sentAt: '2026-11-09T00:00:00Z' }],
      dnc: new Map([['p1', { flag: false, touches: [{ outcome: 'do_not_call', occurredAt: '2026-11-01T00:00:00Z' }] }]]),
      lastHumanTouchAt: new Map(),
    })
    expect(signals).toEqual([])
  })
  it('同一个人有「别再联系」就不降级成只别打电话的提示', () => {
    const { signals } = pickStopSignals({
      messages: [
        { clientId: 'c', contactId: 'p1', body: 'do not follow up', sentAt: '2026-11-08T00:00:00Z' },
        { clientId: 'c', contactId: 'p1', body: '不要打电话', sentAt: '2026-11-09T00:00:00Z' },
      ],
      dnc: new Map(),
      lastHumanTouchAt: new Map(),
    })
    expect(signals.map((s) => s.scope)).toEqual(['all'])
  })

  const T0 = '2026-10-01T00:00:00.000Z'
  const later = (h: number) => new Date(Date.parse(T0) + h * 3_600_000).toISOString()

  it('拒联之后客人私信「不要打电话」不算回头', () => {
    const decision = decideReengageClear({
      asOf: '2027-01-01T00:00:00.000Z',
      contactFlag: true,
      reason: null,
      touches: [
        { id: 'v1', source: 'me_manual', channel: 'phone', direction: 'outbound', occurredAt: T0, outcome: 'do_not_contact' },
      ],
      inboundMessages: [{ id: 'm1', channel: 'messenger', sentAt: later(24), body: 'no calls pls' }],
    })
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })
  it('只别打电话的人重填表单 → 不自动解除（扫描只看全面拒绝）', () => {
    const decision = decideReengageClear({
      asOf: '2027-01-01T00:00:00.000Z',
      contactFlag: false,
      reason: null,
      touches: [
        { id: 'v1', source: 'me_manual', channel: 'phone', direction: 'outbound', occurredAt: T0, outcome: 'do_not_call' },
        { id: 'f1', source: 'meta_lead_form', channel: 'meta_lead_form', direction: 'inbound', occurredAt: later(48) },
      ],
      inboundMessages: [],
    })
    expect(decision).toEqual({ clear: false, why: 'not_dnc' })
  })
})

describe('never call 不许被读成约了回电（魏征复审 P0-gap）', () => {
  it.each(['never call me', 'call me back never'])('%s → 按全面拒绝，不排回电', (note) => {
    const v = classifyNote(note)
    expect(v.outcome).not.toBe('callback_set')
    expect(v).toEqual({ outcome: 'do_not_contact', do_not_contact: true, refusal_scope: 'needs_review' })
  })
  it('not interested + 不要电话 → 全拦（旧代码判 not_interested 停邮件，不能放回邮件）', () => {
    expect(classifyNote('not interested do not call').do_not_contact).toBe(true)
  })
})
