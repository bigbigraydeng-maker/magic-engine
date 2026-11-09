/**
 * 邮箱付款确认 → 成交识别批处理里「自动车道记完成交后推进联系人 CRM 阶段」的测试。
 *
 * 钉住的契约（见 payment-email-detect-run.ts 的 advanceStageForPayment / approveAndSend）：
 *   · 自动车道记完成交后，把联系人阶段往前推一档（定金→deposit_paid，全款→paid_full）；
 *   · 推进是「尽力而为」：任何失败/被拒只计数（stageAdvanceFailed），绝不阻断发送；
 *   · 已经处于更靠后的阶段（paid_full / traveling_soon / not_interested）不再被覆盖；
 *   · 传 expectedFromStage = 库里当前 stage，让并发闸生效。
 *
 * 假库按「表」建模（不按调用次序），风格照抄 __tests__/payment-email-detect-run.test.ts。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/conversions/writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: 'ok', writebackId: 'wb' })),
}))

vi.mock('@/lib/crm/advance-contact-stage', () => ({
  advanceContactStage: vi.fn(async () => ({ ok: true, stage: 'deposit_paid', changed: true })),
}))

import { sendApprovedOutcome } from '@/lib/conversions/writeback-service'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'
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

function seed(opts: { stage?: string | null } = {}) {
  db = {
    clients: [
      {
        id: CLIENT,
        domain: 'shop.example',
        leads_config: { payment_email_detect: { enabled: true, default_currency: 'NZD' } },
      },
    ],
    conversations: [{ id: 'conv-1', client_id: CLIENT, channel: 'email', contact_id: cid(1), last_message_at: SENT }],
    conversation_messages: [
      { id: 'm-row-1', conversation_id: 'conv-1', message_id: 'msg-1', direction: 'outbound', sent_at: SENT, body: 'preview' },
    ],
    contacts: [{ id: cid(1), client_id: CLIENT, display_name: 'Sam Customer', do_not_contact: false, stage: opts.stage ?? 'contacted' }],
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

function mail(body: string, opts: { to?: string; subject?: string; recipientCount?: number } = {}) {
  return {
    ok: true as const,
    message: {
      subject: opts.subject ?? 'Your booking',
      body,
      firstRecipient: { address: opts.to ?? 'sam@customer.test', name: null },
      recipientCount: opts.recipientCount ?? 1,
    },
  }
}

const DEPOSIT = 'Hi Sam, your deposit of $500.00 has been received. Invoice INV-20481. Thanks!'
const FULL = 'Hi Sam, your full payment of $500.00 has been received. Invoice INV-20481. Thanks!'

function deps(over: Partial<PaymentDetectDeps> = {}): PaymentDetectDeps {
  return {
    supabase,
    fetchText: vi.fn(async (_id: string) => mail(DEPOSIT)),
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
  vi.mocked(advanceContactStage).mockReset()
  vi.mocked(advanceContactStage).mockResolvedValue({ ok: true, stage: 'deposit_paid', changed: true })
})

describe('自动车道记完成交后推进 CRM 阶段', () => {
  it('定金 + 联系人当前 contacted → 推进到 deposit_paid，expectedFrom 传当前 stage；发送照常', async () => {
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(1)
    expect(s.stageAdvanceFailed).toBe(0)
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
    expect(advanceContactStage).toHaveBeenCalledWith(
      supabase,
      CLIENT,
      cid(1),
      'deposit_paid',
      expect.any(String),
      expect.any(String),
      'contacted',
    )
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('全款 → 推进到 paid_full', async () => {
    const d = deps({ fetchText: vi.fn(async (_id: string) => mail(FULL)) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(1)
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
    expect(advanceContactStage).toHaveBeenCalledWith(
      supabase,
      CLIENT,
      cid(1),
      'paid_full',
      expect.any(String),
      expect.any(String),
      'contacted',
    )
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('联系人已经是 paid_full，再来定金确认 → 不推进，发送照常', async () => {
    seed({ stage: 'paid_full' })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(advanceContactStage).not.toHaveBeenCalled()
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('联系人 not_interested → 不推进，发送照常', async () => {
    seed({ stage: 'not_interested' })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(advanceContactStage).not.toHaveBeenCalled()
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('advanceContactStage 返回 409 → stageAdvanceFailed 1，发送照常', async () => {
    vi.mocked(advanceContactStage).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'x',
      actualStage: 'quoted',
    })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(s.stageAdvanceFailed).toBe(1)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('advanceContactStage 抛异常 → stageAdvanceFailed 1，发送照常', async () => {
    vi.mocked(advanceContactStage).mockRejectedValue(new Error('boom'))
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(s.stageAdvanceFailed).toBe(1)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })
})
