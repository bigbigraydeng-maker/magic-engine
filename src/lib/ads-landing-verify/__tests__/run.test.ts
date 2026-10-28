import { describe, expect, it, vi } from 'vitest'
import type { CardFacts, ConfirmationCardView } from '@/lib/confirmation-card'
import { landingCardFacts, landingCardFingerprint } from '../card'
import { isLandingConfirmed } from '../confirm'
import { runLandingVerify, type LandingRunDeps } from '../run'
import { receiptBody } from '../receipt'
import { writeLandingReceipt } from '../store'

const NOW = new Date('2026-10-28T12:00:00.000Z')
const SITE = 'https://example.test'
const DRAFT = 'draft-1'

function payload(extra: Record<string, unknown> = {}) {
  return {
    status: 'awaiting_approval',
    accountLabel: '演示广告账户',
    draft: { kind: 'video_thruplay', linkUrl: `${SITE}/offer`, ...extra },
  }
}

function card(facts: CardFacts): ConfirmationCardView {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    fingerprint: landingCardFingerprint(facts),
    what: facts.what,
    account: facts.account,
    amount: facts.amount,
    date: facts.date,
    scope: facts.scope,
    expiresLabel: '请在时限前点。',
    status: 'waiting',
    statusLine: '还没人点。',
    confirmEnabled: true,
    declineEnabled: true,
    blockedReason: null,
  }
}

function deps(patch: Partial<LandingRunDeps> & { payload?: Record<string, unknown> } = {}): LandingRunDeps & { saved: { value: unknown } } {
  const saved: { value: unknown } = { value: null }
  const state = { issued: 0 }
  const base: LandingRunDeps = {
    now: NOW,
    siteUrl: SITE,
    clicker: { kind: 'opc', email: 'opc@example.com' },
    load: async () => ({ ok: true, payload: patch.payload ?? payload() }),
    save: async (_payload, receipt) => {
      saved.value = receipt
      return { ok: true }
    },
    confirmed: async () => false,
    issue: async (facts) => {
      state.issued += 1
      return card(facts)
    },
    readPage: async () => ({ status: 200, finalUrl: `${SITE}/offer`, html: '<main>Hello</main>', error: null }),
    ...patch,
  }
  return Object.assign(base, { saved, issued: 0, get issuedCount() { return state.issued } })
}

describe('run landing verify', () => {
  it('stores a pass and does not ask for a card', async () => {
    const harness = deps()
    const result = await runLandingVerify(harness, DRAFT, false)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.clear).toBe(true)
    expect(result.view.card).toBeNull()
    expect(harness.saved.value).toBeTruthy()
  })

  it('asks a person when the page does not open, and does not fetch off-site', async () => {
    const readPage = vi.fn(async () => ({ status: 500, finalUrl: null, html: null, error: null }))
    const failed = deps({ readPage, payload: payload() })
    const result = await runLandingVerify(failed, DRAFT, true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.clear).toBe(false)
    expect(result.view.card?.what).toContain('落地页或表单')
    expect(result.view.lines.some((line) => line.includes('没通过'))).toBe(true)

    const offsite = vi.fn()
    const blocked = deps({
      readPage: offsite,
      payload: payload({ linkUrl: 'https://other.test/offer' }),
    })
    const second = await runLandingVerify(blocked, DRAFT, true)
    expect(offsite).not.toHaveBeenCalled()
    expect(second.ok).toBe(true)
    if (second.ok) expect(JSON.stringify(second.view.lines)).not.toContain('other.test')
  })

  it('does not open the page again until asked', async () => {
    const readPage = vi.fn(async () => ({
      status: 200,
      finalUrl: `${SITE}/offer`,
      html: '<main>Hello</main>',
      error: null,
    }))
    const first = deps({ readPage })
    await runLandingVerify(first, DRAFT, true)
    readPage.mockClear()
    const second = deps({
      readPage,
      payload: { ...payload(), landing_verify: first.saved.value },
    })
    await runLandingVerify(second, DRAFT, false)
    expect(readPage).not.toHaveBeenCalled()
    await runLandingVerify(second, DRAFT, true)
    expect(readPage).toHaveBeenCalledTimes(1)
  })
})

describe('landing confirmation', () => {
  it('counts only an authorised card for this exact result', async () => {
    const receipt = receiptBody(NOW.toISOString(), 'key', [
      { key: 'loads', state: 'fail', detail: '页面没有打开' },
      { key: 'right_page', state: 'unchecked', detail: '页面没打开，对不上是不是这一页' },
      { key: 'form_fields', state: 'unchecked', detail: '页面没打开，表单字段没读到' },
      { key: 'utm', state: 'skip', detail: '没有网址，不查追踪参数' },
    ])
    const facts = landingCardFacts(DRAFT, '演示广告账户', receipt)!
    const input = {
      subject_key: facts.subjectKey,
      content_fingerprint: landingCardFingerprint(facts),
      what: facts.what,
      account_label: facts.account,
      amount_label: facts.amount,
      date_label: facts.date,
      scope_label: facts.scope,
      issued_at: NOW.toISOString(),
      hard_checks: JSON.stringify(facts.hardChecks),
    }
    const chain = (data: unknown) => {
      const query = {
        select: () => query,
        eq: () => query,
        filter: () => query,
        limit: async () => ({ data, error: null }),
      }
      return { from: () => query }
    }
    expect(await isLandingConfirmed(chain([{ status: 'authorized', input }]) as never, 'client-1', DRAFT, '演示广告账户', receipt)).toBe(true)
    const other = { ...input, content_fingerprint: 'b'.repeat(64) }
    expect(await isLandingConfirmed(chain([{ status: 'authorized', input: other }]) as never, 'client-1', DRAFT, '演示广告账户', receipt)).toBe(false)
  })

  it('does not write the receipt onto an ad that is no longer waiting', async () => {
    const receipt = receiptBody(NOW.toISOString(), 'key', [
      { key: 'loads', state: 'pass', detail: '页面能打开' },
      { key: 'right_page', state: 'pass', detail: '打开的就是这一页' },
      { key: 'form_fields', state: 'skip', detail: '这一页没有表单' },
      { key: 'utm', state: 'skip', detail: '这条广告没有带追踪参数' },
    ])
    const update = vi.fn()
    const sb = { from: () => ({ update }) }
    const result = await writeLandingReceipt(sb as never, 'client-1', DRAFT, { status: 'active' }, receipt)
    expect(result.ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})
