/**
 * messenger / whatsapp 付款确认 → 成交识别的测试。假库按「表」建模（不按调用次序），
 * 与 `__tests__/payment-email-detect-run.test.ts` 同款，扩展了：
 *   · `conversations` 支持 `.in('channel', [...])`，行带 `channel` 与 `participant_psid`
 *   · `conversation_messages` 行带 `body`
 *   · `me_sale_outcomes` 支持 `.in('source_kind', [...])`
 *
 * 钉住的契约：
 *   · messenger/whatsapp 全文已在库里，绝不调 `deps.fetchText`
 *   · messenger 走 `source_kind:'messenger_conversation'`，`page_scoped_user_id` = 会话的 participant_psid
 *   · whatsapp 的 `page_scoped_user_id` 为 null
 *   · 平台会话只走自动车道：任何一条不满足就整封丢弃（`not_auto_eligible`），绝不写人工行
 *   · 同一封消息重跑不重复写、不重复发
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/conversions/writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: 'ok', writebackId: 'wb' })),
}))

import { sendApprovedOutcome } from '@/lib/conversions/writeback-service'
import {
  runPaymentEmailDetection,
  type PaymentDetectDeps,
} from '@/lib/conversions/payment-email-detect-run'

type Row = Record<string, unknown>
const CLIENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-04T00:00:00.000Z')
const SENT = '2026-10-03T00:00:00.000Z'
/** 联系人 id 必须是 uuid（intake 会校验）。 */
const cid = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`

let db: Record<string, Row[]>
let uid = 0

function table(name: string) {
  const filters: Array<(r: Row) => boolean> = []
  let patch: Row | null = null
  let head = false
  let limitN: number | null = null
  let affected = false

  const rows = () => (db[name] ?? []).filter((r) => filters.every((f) => f(r)))
  const b: Record<string, unknown> = {
    select: (_c?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true
      if (patch) affected = true
      return b
    },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
    is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), b),
    not: (c: string, _op: string, v: unknown) => (filters.push((r) => (v === null ? r[c] != null : r[c] !== v)), b),
    gte: (c: string, v: unknown) => (filters.push((r) => String(r[c]) >= String(v)), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    order: () => b,
    limit: (n: number) => ((limitN = n), b),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => {
      const r = rows()[0]
      return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } }
    },
    update: (p: Row) => ((patch = p), b),
    insert: (row: Row) => {
      const doInsert = () => {
        if (name === 'me_sale_outcomes') {
          const clash = (db[name] ?? []).some(
            (r) => r.client_id === row.client_id && r.source_kind === row.source_kind && r.source_ref === row.source_ref,
          )
          if (clash) return { data: null, error: { code: '23505', message: 'dup' } }
        }
        const stored = { id: `id-${++uid}`, review_status: 'pending_review', redacted_at: null, ...row }
        ;(db[name] ??= []).push(stored)
        return { data: stored, error: null }
      }
      const res = doInsert()
      return {
        select: () => ({ single: async () => res }),
        then: (ok: (v: unknown) => unknown) => ok(res),
      }
    },
    then: (ok: (v: unknown) => unknown) => {
      if (patch) {
        const hit = rows()
        hit.forEach((r) => Object.assign(r, patch))
        return ok({ data: affected ? hit.map((r) => ({ id: r.id })) : null, error: null })
      }
      const list = limitN != null ? rows().slice(0, limitN) : rows()
      return ok(head ? { data: null, count: list.length, error: null } : { data: list, error: null })
    },
  }
  return b
}

interface SeedOpts {
  enabled?: boolean
  channel?: 'email' | 'messenger' | 'whatsapp'
  participantPsid?: string | null
  body?: string
  extraMessages?: Row[]
}

function seed(opts: SeedOpts = {}) {
  const channel = opts.channel ?? 'email'
  db = {
    clients: [
      {
        id: CLIENT,
        domain: 'shop.example',
        leads_config: opts.enabled === false ? {} : { payment_email_detect: { enabled: true, default_currency: 'NZD' } },
      },
    ],
    conversations: [
      {
        id: 'conv-1',
        client_id: CLIENT,
        channel,
        contact_id: cid(1),
        participant_psid: opts.participantPsid ?? null,
        last_message_at: SENT,
      },
    ],
    conversation_messages: [
      {
        id: 'm-row-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        direction: 'outbound',
        sent_at: SENT,
        body: opts.body ?? 'preview',
      },
      ...(opts.extraMessages ?? []),
    ],
    contacts: [{ id: cid(1), client_id: CLIENT, display_name: 'Sam Customer', do_not_contact: false }],
    contact_identities: [
      { contact_id: cid(1), client_id: CLIENT, kind: 'email', value: 'sam@customer.test' },
      { contact_id: cid(1), client_id: CLIENT, kind: 'phone', value: '+64211234567' },
    ],
    contact_touchpoints: [
      { contact_id: cid(1), client_id: CLIENT, source: 'meta_lead_form', source_ref: '123456789012345', occurred_at: SENT },
    ],
    me_sale_outcomes: [],
    me_conversion_audit: [],
  }
}

// 假库只实现被测代码真调用的那几个方法；形状已跑实测覆盖（被测代码若调用了
// 假库没有的方法，用例会直接抛 TypeError，不会静默通过）。
const supabase = { from: (t: string) => table(t) } as unknown as PaymentDetectDeps['supabase']

const GOOD = 'Hi Sam, your deposit of $500.00 has been received. Invoice INV-9001.'

function deps(over: Partial<PaymentDetectDeps> = {}): PaymentDetectDeps {
  return {
    supabase,
    fetchText: vi.fn(async (_id: string) => {
      throw new Error('fetchText must not be called for messenger/whatsapp')
    }),
    sendDeps: {} as PaymentDetectDeps['sendDeps'],
    mailboxAddress: 'info@shop.example',
    now: NOW,
    ...over,
  }
}

beforeEach(() => {
  seed()
  uid = 0
  vi.mocked(sendApprovedOutcome).mockClear()
})

describe('messenger 自动车道', () => {
  it('证据齐全：写成交 → 自动批准 → 发送一次；不调 fetchText', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const d = deps()
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s).toMatchObject({ autoCreated: 1, autoApproved: 1 })
    expect(d.fetchText).not.toHaveBeenCalled()
    const row = db.me_sale_outcomes[0]
    expect(row).toMatchObject({
      outcome_kind: 'purchase',
      source_kind: 'messenger_conversation',
      source_ref: 'msg-1',
      review_status: 'approved',
      reviewed_by: 'auto:payment-email-evidence',
      amount_minor: 50000,
      currency: 'NZD',
      order_ref: 'INV9001',
      page_scoped_user_id: 'PSID-123',
      contact_id: cid(1),
    })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('byChannel.messenger 的 scanned / confirmed 计数', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.byChannel.messenger).toEqual({ scanned: 1, confirmed: 1 })
    expect(s.byChannel.email).toEqual({ scanned: 0, confirmed: 0 })
  })
})

describe('whatsapp 只识别、不自动发', () => {
  it('证据齐全也不自动：不写库、needsHuman 有 not_auto_eligible、不发送', async () => {
    seed({ channel: 'whatsapp', participantPsid: 'PSID-999', body: GOOD })
    const d = deps()
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s).toMatchObject({ autoCreated: 0, autoApproved: 0 })
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'not_auto_eligible' }])
    expect(d.fetchText).not.toHaveBeenCalled()
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})

describe('messenger 人工/丢弃车道', () => {
  it('没有金额 → 不写库，needsHuman 有 amount_missing', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: 'Your deposit has been received.' })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'amount_missing' }])
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('线程里有取消字样 → needsHuman 有 cancel_words_in_thread，不写库', async () => {
    seed({
      channel: 'messenger',
      participantPsid: 'PSID-123',
      body: GOOD,
      extraMessages: [
        {
          id: 'm-row-0',
          conversation_id: 'conv-1',
          message_id: 'msg-0',
          direction: 'inbound',
          sent_at: SENT,
          body: 'Sorry, I need to cancel',
        },
      ],
    })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman.some((n) => n.reason === 'cancel_words_in_thread')).toBe(true)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('金额只在邻句（非自动）→ 不写库，needsHuman 有 not_auto_eligible', async () => {
    seed({
      channel: 'messenger',
      participantPsid: 'PSID-123',
      body: 'Thank you, your deposit has been received. Amount: $500.00.',
    })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(0)
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'not_auto_eligible' }])
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})

describe('messenger 幂等', () => {
  it('同一封消息重跑 → 不再读、不重复写、不重复发', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    await runPaymentEmailDetection(CLIENT, deps())
    const d2 = deps()
    const s2 = await runPaymentEmailDetection(CLIENT, d2)
    expect(s2.reason).toBe('no_candidates')
    expect(d2.fetchText).not.toHaveBeenCalled()
    expect(db.me_sale_outcomes).toHaveLength(1)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })
})
