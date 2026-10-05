/**
 * 付款确认识别批处理的「加固」测试：把几条撤不回 / 容易回归的契约单独钉死。
 *
 * 假库按「表」建模（不按调用次序），风格照抄 __tests__/payment-conversation.test.ts 与
 * __tests__/payment-stage.test.ts（同一套 table() 助手、同一套 seed 夹具、同一套 mock 设置）。
 *
 * 钉住的契约：
 *   · whatsapp 只识别、不自动发：证据齐全也不写库、不发送，needsHuman 记 not_auto_eligible；
 *     dryRun 下 wouldAuto 也保持 0（whatsapp 永远不进自动车道）。
 *   · messenger 自动车道：入库那一刻就是 approved（reviewed_by = auto:payment-email-evidence），
 *     绝不存在 pending_review 的中间态；审计里有 auto_approved_by_payment_evidence；只发一次。
 *   · 阶段推进只在发送之后：发送抛异常 → 不推进、stageAdvanced 0；正常发送 → 推进一次。
 *   · 只有 new / contacted / quoted（或 stage 为 null）才推进；deferred / no_response / deposit_paid 不推进。
 *   · 线程里出现中文取消/退款字样（「客人说想取消」「我想退款」）→ 转人工，不写库。
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

interface SeedOpts {
  enabled?: boolean
  channel?: 'email' | 'messenger' | 'whatsapp'
  participantPsid?: string | null
  body?: string
  stage?: string | null
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
    contacts: [
      {
        id: cid(1),
        client_id: CLIENT,
        display_name: 'Sam Customer',
        do_not_contact: false,
        stage: opts.stage ?? 'contacted',
      },
    ],
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
  vi.mocked(sendApprovedOutcome).mockResolvedValue({ status: 'confirmed', message: 'ok', writebackId: 'wb' })
  vi.mocked(advanceContactStage).mockReset()
  vi.mocked(advanceContactStage).mockResolvedValue({ ok: true, stage: 'deposit_paid', changed: true })
})

describe('whatsapp 只识别、不自动发（加固）', () => {
  it('证据齐全也不写库、不发送，needsHuman 记 not_auto_eligible', async () => {
    seed({ channel: 'whatsapp', participantPsid: 'PSID-999', body: GOOD })
    const d = deps()
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s).toMatchObject({ autoCreated: 0, autoApproved: 0, wouldAuto: 0 })
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'not_auto_eligible' }])
    expect(d.fetchText).not.toHaveBeenCalled()
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('dryRun 下 wouldAuto 保持 0（whatsapp 永远不进自动车道）', async () => {
    seed({ channel: 'whatsapp', participantPsid: 'PSID-999', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps({ dryRun: true }))
    expect(s.wouldAuto).toBe(0)
    expect(s.autoCreated).toBe(0)
    expect(s.autoApproved).toBe(0)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})

describe('messenger 自动车道：入库即 approved（加固）', () => {
  it('插入的成交行 review_status 是 approved、reviewed_by 是 auto:payment-email-evidence；从无 pending_review 中间态', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s).toMatchObject({ autoCreated: 1, autoApproved: 1 })
    expect(db.me_sale_outcomes).toHaveLength(1)
    const row = db.me_sale_outcomes[0]
    expect(row.review_status).toBe('approved')
    expect(row.reviewed_by).toBe('auto:payment-email-evidence')
    // 入库那一刻就是 approved：库里任何时刻都不该出现 pending_review 的成交行。
    expect(db.me_sale_outcomes.some((r) => r.review_status === 'pending_review')).toBe(false)
  })

  it('审计里有 auto_approved_by_payment_evidence，且只发一次', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    const actions = db.me_conversion_audit.map((r) => r.action)
    expect(actions).toContain('auto_approved_by_payment_evidence')
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })
})

describe('子牙 Round 2：messenger 无 PSID / 被拦下的发送', () => {
  it('🔴 messenger 会话没有 PSID（只有邮箱/电话）→ 不自动发，needsHuman 记 not_auto_eligible', async () => {
    seed({ channel: 'messenger', participantPsid: null, body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'not_auto_eligible' }])
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('🔴 发送被拦下（redacted：拒联/已删除个人信息）→ 不改客人阶段', async () => {
    vi.mocked(sendApprovedOutcome).mockResolvedValueOnce({ status: 'redacted', message: 'blocked', writebackId: null } as never)
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('审计里记明这条是「入库即已批准」', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    await runPaymentEmailDetection(CLIENT, deps())
    const audit = db.me_conversion_audit.find((r) => r.action === 'auto_approved_by_payment_evidence')
    expect(audit?.detail).toMatchObject({ pre_approved: true })
  })
})

describe('阶段推进只在发送之后（加固）', () => {
  it('发送抛异常 → 不推进阶段，stageAdvanced 0', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    vi.mocked(sendApprovedOutcome).mockRejectedValueOnce(new Error('boom'))
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it('正常发送 → 推进一次', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(1)
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })
})

describe('阶段推进的起点白名单（加固）', () => {
  it.each(['deferred', 'no_response', 'deposit_paid'])('当前 stage %s → 不推进', async (stage) => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD, stage })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(0)
    expect(advanceContactStage).not.toHaveBeenCalled()
  })

  it.each(['quoted', 'new'])('当前 stage %s → 推进', async (stage) => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD, stage })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(1)
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })

  it('当前 stage 为 null → 推进', async () => {
    seed({ channel: 'messenger', participantPsid: 'PSID-123', body: GOOD, stage: null })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
    expect(s.stageAdvanced).toBe(1)
    expect(advanceContactStage).toHaveBeenCalledTimes(1)
  })
})

describe('线程里的中文取消/退款字样（加固）', () => {
  it('线程含「客人说想取消」→ needsHuman 记 cancel_words_in_thread，不写库', async () => {
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
          body: '客人说想取消',
        },
      ],
    })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman.some((n) => n.reason === 'cancel_words_in_thread')).toBe(true)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('线程含「我想退款」→ needsHuman 记 cancel_words_in_thread，不写库', async () => {
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
          body: '我想退款',
        },
      ],
    })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman.some((n) => n.reason === 'cancel_words_in_thread')).toBe(true)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})
