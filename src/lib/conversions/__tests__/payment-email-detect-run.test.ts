/**
 * 邮箱付款确认 → 成交识别批处理的测试。假库按「表」建模（不按调用次序）。
 *
 * 钉住的契约：
 *   · 客户配置没开 → 一条都不处理（fail-closed）
 *   · 自动车道只在证据齐全时进；任何疑点都落到人工车道（pending_review，不外发）
 *   · 金额缺失/多个、跨来源已有成交、线程里有取消字样 → 不写库
 *   · 干跑（dryRun）不写库、不外发
 *   · 单次运行自动发送有上限
 *   · 审计里不存邮件原文，只存证据句的 sha256
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: 'ok', writebackId: 'wb' })),
}))

import { sendApprovedOutcome } from '../writeback-service'
import {
  decideLane,
  runPaymentEmailDetection,
  MAX_AUTO_SENDS_PER_RUN,
  type PaymentDetectDeps,
} from '../payment-email-detect-run'
import type { PaymentExtraction } from '../payment-email-extract'

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

function seed(opts: { enabled?: boolean } = {}) {
  db = {
    clients: [
      {
        id: CLIENT,
        domain: 'shop.example',
        leads_config: opts.enabled === false ? {} : { payment_email_detect: { enabled: true, default_currency: 'NZD' } },
      },
    ],
    conversations: [{ id: 'conv-1', client_id: CLIENT, channel: 'email', contact_id: cid(1), last_message_at: SENT }],
    conversation_messages: [
      { id: 'm-row-1', conversation_id: 'conv-1', message_id: 'msg-1', direction: 'outbound', sent_at: SENT, body: 'preview' },
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

// 假库只实现被测代码真调用的那几个方法；形状已跑 21 条用例实测覆盖（被测代码若调用了
// 假库没有的方法，用例会直接抛 TypeError，不会静默通过）。
const supabase = { from: (t: string) => table(t) } as unknown as PaymentDetectDeps['supabase']

function mail(body: string, opts: { to?: string; subject?: string } = {}) {
  return {
    ok: true as const,
    message: {
      subject: opts.subject ?? 'Your booking',
      body,
      firstRecipient: { address: opts.to ?? 'sam@customer.test', name: null },
    },
  }
}

const GOOD = 'Hi Sam, your deposit of $500.00 has been received. Invoice INV-20481. Thanks!'

function deps(over: Partial<PaymentDetectDeps> = {}): PaymentDetectDeps {
  return {
    supabase,
    fetchText: vi.fn(async () => mail(GOOD)),
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

describe('开关与干跑', () => {
  it('客户没开 payment_email_detect → 不读邮件、不写库', async () => {
    seed({ enabled: false })
    const d = deps()
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s).toMatchObject({ ran: false, reason: 'disabled' })
    expect(d.fetchText).not.toHaveBeenCalled()
  })

  it('dryRun：只统计「本来会自动」，不写库、不外发', async () => {
    const s = await runPaymentEmailDetection(CLIENT, deps({ dryRun: true }))
    expect(s.wouldAuto).toBe(1)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})

describe('自动车道', () => {
  it('证据齐全：写成交 → 自动批准 → 发送一次；审计不含邮件原文', async () => {
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s).toMatchObject({ autoCreated: 1, autoApproved: 1 })
    const row = db.me_sale_outcomes[0]
    expect(row).toMatchObject({
      outcome_kind: 'purchase',
      source_kind: 'inbox_extract',
      source_ref: 'msg-1',
      review_status: 'approved',
      reviewed_by: 'auto:payment-email-evidence',
      amount_minor: 50000,
      currency: 'NZD',
      order_ref: 'INV20481',
      meta_lead_id: '123456789012345',
      contact_id: cid(1),
    })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    const audit = JSON.stringify(db.me_conversion_audit)
    expect(audit).not.toContain('deposit of')
    expect(audit).toMatch(/evidence_sha256/)
  })

  it('同一封邮件重跑 → 不再读、不重复发', async () => {
    await runPaymentEmailDetection(CLIENT, deps())
    const d2 = deps()
    const s2 = await runPaymentEmailDetection(CLIENT, d2)
    expect(s2.reason).toBe('no_candidates')
    expect(d2.fetchText).not.toHaveBeenCalled()
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
  })

  it('单次运行自动发送有上限，超出的落到人工车道', async () => {
    const extra = Array.from({ length: MAX_AUTO_SENDS_PER_RUN + 1 }, (_, i) => i + 2)
    for (const n of extra) {
      db.conversations.push({ id: `conv-${n}`, client_id: CLIENT, channel: 'email', contact_id: cid(n), last_message_at: SENT })
      db.conversation_messages.push({ id: `r${n}`, conversation_id: `conv-${n}`, message_id: `msg-${n}`, direction: 'outbound', sent_at: SENT, body: 'x' })
      db.contacts.push({ id: cid(n), client_id: CLIENT, display_name: `Person ${n}`, do_not_contact: false })
      db.contact_identities.push({ contact_id: cid(n), client_id: CLIENT, kind: 'email', value: 'sam@customer.test' })
    }
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(MAX_AUTO_SENDS_PER_RUN)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(MAX_AUTO_SENDS_PER_RUN)
    expect(s.needsHuman.some((n) => n.reason === 'auto_cap_reached')).toBe(true)
    expect(db.me_sale_outcomes.filter((r) => r.review_status === 'pending_review').length).toBeGreaterThan(0)
  })
})

describe('人工车道：写 pending_review，绝不外发', () => {
  it('主题是转发', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail(GOOD, { subject: 'Fw: Booking' })) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.humanQueued).toBe(1)
    expect(db.me_sale_outcomes[0].review_status).toBe('pending_review')
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('收件人邮箱和联系人不一致（代付等）', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail(GOOD, { to: 'agent@travel.test' })) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.humanQueued).toBe(1)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('收件人是自己人域名 → 不当客人', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail(GOOD, { to: 'colleague@shop.example' })) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.humanQueued).toBe(1)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})

describe('不写库的情形（只进 needsHuman 或忽略）', () => {
  it('没有金额 → 数据库不让写，只进清单', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail('Your deposit has been received. Thank you.')) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.needsHuman).toEqual([{ messageId: 'msg-1', reason: 'amount_missing' }])
    expect(db.me_sale_outcomes).toHaveLength(0)
  })

  it('金额有两个 → ambiguous，不选', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail('Your deposit of $500 has been received out of $5,000.')) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.needsHuman[0].reason).toBe('amount_ambiguous')
    expect(db.me_sale_outcomes).toHaveLength(0)
  })

  it('线程里有取消/退款字样', async () => {
    db.conversation_messages.push({ id: 'x', conversation_id: 'conv-1', message_id: 'msg-0', direction: 'inbound', sent_at: SENT, body: 'Sorry, I need to cancel' })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.needsHuman.some((n) => n.reason === 'cancel_words_in_thread')).toBe(true)
    expect(db.me_sale_outcomes).toHaveLength(0)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('同一联系人已有任何来源的 purchase（如表格同步）→ 疑似重复，不写', async () => {
    db.me_sale_outcomes.push({ id: 'old', client_id: CLIENT, contact_id: cid(1), outcome_kind: 'purchase', review_status: 'approved', source_kind: 'crm_sheet_sync', source_ref: 'row-9', redacted_at: null })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.duplicates).toBe(1)
    expect(db.me_sale_outcomes).toHaveLength(1)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('已被拒绝的旧成交不占位（人工拒绝后可重新识别）', async () => {
    db.me_sale_outcomes.push({ id: 'old', client_id: CLIENT, contact_id: cid(1), outcome_kind: 'purchase', review_status: 'rejected', source_kind: 'crm_sheet_sync', source_ref: 'row-9', redacted_at: null })
    const s = await runPaymentEmailDetection(CLIENT, deps())
    expect(s.autoApproved).toBe(1)
  })

  it('尾款只忽略；只写 payment received 的 unknown 只报表', async () => {
    const d1 = deps({ fetchText: vi.fn(async () => mail('Your balance payment of $4,000.00 has been received.')) })
    expect((await runPaymentEmailDetection(CLIENT, d1)).balanceIgnored).toBe(1)
    const d2 = deps({ fetchText: vi.fn(async () => mail('Your payment has been received, thank you.')) })
    expect((await runPaymentEmailDetection(CLIENT, d2)).unknownKind).toBe(1)
    expect(db.me_sale_outcomes).toHaveLength(0)
  })

  it('读不到邮件全文 → 计入失败，不猜', async () => {
    const d = deps({ fetchText: vi.fn(async () => ({ ok: false as const, error: 'HTTP 404' })) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.fetchErrors).toBe(1)
    expect(s.needsHuman[0].reason).toBe('mail_text_unreadable')
  })

  it('催款信不是成交', async () => {
    const d = deps({ fetchText: vi.fn(async () => mail('Please find the payment link below: https://pay.example/x')) })
    const s = await runPaymentEmailDetection(CLIENT, d)
    expect(s.notConfirmed).toBe(1)
    expect(db.me_sale_outcomes).toHaveLength(0)
  })
})

describe('decideLane（纯判定）', () => {
  const base = {
    extraction: {
      status: 'confirmed',
      kind: 'deposit',
      amount: { value: '500.00', currency: 'NZD' },
      amountIssue: null,
      invoiceNo: 'INV1',
      invoiceAmbiguous: false,
      evidence: 'x',
      flags: [],
    } as Extract<PaymentExtraction, { status: 'confirmed' }>,
    facts: { displayName: 'A B', doNotContact: false, emails: ['a@b.test'], phone: null, metaLeadId: null },
    recipient: 'a@b.test',
    cancelWords: false,
    duplicate: false,
    ownDomains: ['own.example'],
  }

  it('齐全 → auto', () => expect(decideLane(base).lane).toBe('auto'))
  it('拒联 → skip', () => expect(decideLane({ ...base, facts: { ...base.facts, doNotContact: true } }).lane).toBe('skip'))
  it('发票号歧义 → human', () =>
    expect(decideLane({ ...base, extraction: { ...base.extraction, invoiceAmbiguous: true } }).lane).toBe('human'))
  it('类型不是定金/全款 → human', () =>
    expect(decideLane({ ...base, extraction: { ...base.extraction, kind: 'unknown' } }).lane).toBe('human'))
  it('邮箱大小写不同仍算精确', () => expect(decideLane({ ...base, recipient: 'A@B.test' }).lane).toBe('auto'))
})
