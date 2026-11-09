/**
 * Public application intake: strict parsing, honeypot, hourly caps (fail closed), referral lookup only
 * against approved distributors, same answer for a repeat email, and the HTTP route's guards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown; head?: boolean }
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

const h = vi.hoisted(() => ({
  respond: (() => ({ data: null, error: null })) as (op: Op) => Result,
  calls: [] as Op[],
}))

function builder(table: string) {
  const state: Op = { table, op: 'select', filters: {} }
  const set = (k: string, v: unknown) => { state.filters[k] = v; return b }
  const b = {
    select: (_c?: string, opts?: { head?: boolean }) => { if (opts?.head) state.head = true; return b },
    eq: (k: string, v: unknown) => set(`eq:${k}`, v),
    gte: (k: string, v: unknown) => set(`gte:${k}`, v),
    insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return b },
    maybeSingle: () => b,
    then: (resolve: (r: Result) => unknown) => {
      h.calls.push({ ...state, filters: { ...state.filters } })
      return Promise.resolve(resolve(h.respond(state)))
    },
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }))

import { GLOBAL_HOURLY_LIMIT, PER_SOURCE_HOURLY_LIMIT, clientIpFrom, hashApplicantIp, parseApplication, submitApplication, type ApplicationInput } from '../application'
import { DISTRIBUTOR_TERMS_VERSION, distributorTerms } from '../terms'
import { normaliseReferralCode } from '../referral-code'
import { POST } from '@/app/api/partner/apply/route'

const NOW = Date.parse('2026-11-10T00:00:00Z')
const HASH = 'a'.repeat(64)
const BODY = {
  display_name: ' 王小明 ', contact_email: 'Wang@Example.com', contact_phone: '+64 21 123 4567', region: 'Auckland',
  note: '我做美容店，\n认识很多老板', referral_code: 'abcd-2345', accept_terms: true, terms_version: DISTRIBUTOR_TERMS_VERSION, website: '',
}

function input(over: Partial<ApplicationInput> = {}): ApplicationInput {
  const parsed = parseApplication(BODY)
  if (!parsed.ok) throw new Error('fixture invalid')
  return { ...parsed.value, ...over }
}

/** Counts: per-source query has an applicant_ip_hash filter, global does not. */
function respondWith(opts: { perSource?: number; global?: number; upline?: string | null; insertError?: { message: string; code?: string } | null; countError?: boolean }) {
  return (op: Op): Result => {
    if (op.head) {
      if (opts.countError) return { data: null, error: { message: 'down' }, count: null }
      return { data: null, error: null, count: 'eq:applicant_ip_hash' in op.filters ? opts.perSource ?? 0 : opts.global ?? 0 }
    }
    if (op.op === 'select') return { data: opts.upline ? { id: opts.upline } : null, error: null }
    return { data: null, error: opts.insertError ?? null }
  }
}

beforeEach(() => { h.calls = []; h.respond = respondWith({}) })

describe('parseApplication', () => {
  it('cleans the fields, lower-cases the email and normalises the referral code', () => {
    const parsed = parseApplication(BODY)
    expect(parsed).toEqual({ ok: true, value: {
      displayName: '王小明', contactEmail: 'wang@example.com', contactPhone: '+64 21 123 4567', region: 'Auckland',
      note: '我做美容店，\n认识很多老板', referralCode: 'ABCD2345', termsVersion: DISTRIBUTOR_TERMS_VERSION, isBot: false,
    } })
  })

  it('refuses without ticking the terms, with a stale terms version, or with a malformed code', () => {
    const bad = (over: Record<string, unknown>) => parseApplication({ ...BODY, ...over })
    expect(bad({ accept_terms: false })).toMatchObject({ ok: false })
    expect(bad({ accept_terms: 'true' })).toMatchObject({ ok: false })
    expect(bad({ terms_version: 'distributor-terms-old' })).toMatchObject({ ok: false })
    expect(bad({ referral_code: 'O0O0O0O0' })).toMatchObject({ ok: false })
    expect(bad({ contact_email: 'not-an-email' })).toMatchObject({ ok: false })
    expect(bad({ contact_phone: 'call me' })).toMatchObject({ ok: false })
    expect(bad({ note: 'x'.repeat(1001) })).toMatchObject({ ok: false })
    expect(parseApplication(undefined)).toMatchObject({ ok: false })
  })

  it('flags a filled honeypot instead of rejecting it', () => {
    expect(parseApplication({ ...BODY, website: 'http://spam' })).toMatchObject({ ok: true, value: { isBot: true } })
  })

  it('reads codes the way people type them', () => {
    expect(normaliseReferralCode(' abcd 2345 ')).toBe('ABCD2345')
    expect(normaliseReferralCode('ABCD234')).toBeNull()
    expect(normaliseReferralCode(undefined)).toBeNull()
  })
})

describe('submitApplication', () => {
  it('stores a pending application under the approved upline the code belongs to', async () => {
    h.respond = respondWith({ upline: 'up-1' })
    await submitApplication(input(), HASH, NOW)
    const lookup = h.calls.find((c) => c.op === 'select' && !c.head)
    expect(lookup?.filters).toEqual({ 'eq:referral_code': 'ABCD2345', 'eq:status': 'approved' })
    const insert = h.calls.find((c) => c.op === 'insert')?.payload as Record<string, unknown>
    expect(insert).toMatchObject({ parent_id: 'up-1', source: 'application', applicant_ip_hash: HASH, terms_version: DISTRIBUTOR_TERMS_VERSION, terms_accepted_at: '2026-11-10T00:00:00.000Z' })
    // The applicant can never set their own status, approval or referral code.
    expect(insert).not.toHaveProperty('status')
    expect(insert).not.toHaveProperty('approved_by')
    expect(insert).not.toHaveProperty('referral_code')
  })

  it('rejects a code that is not an approved distributor, without storing anything', async () => {
    h.respond = respondWith({ upline: null })
    await expect(submitApplication(input(), HASH, NOW)).rejects.toMatchObject({ status: 400 })
    expect(h.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('caps one source and everyone per hour, and refuses when it cannot count', async () => {
    h.respond = respondWith({ perSource: PER_SOURCE_HOURLY_LIMIT })
    await expect(submitApplication(input(), HASH, NOW)).rejects.toMatchObject({ status: 429 })
    h.respond = respondWith({ perSource: 0, global: GLOBAL_HOURLY_LIMIT })
    await expect(submitApplication(input(), HASH, NOW)).rejects.toMatchObject({ status: 429 })
    h.respond = respondWith({ countError: true })
    await expect(submitApplication(input(), HASH, NOW)).rejects.toMatchObject({ status: 503 })
    expect(h.calls.some((c) => c.op === 'insert')).toBe(false)
    const window = h.calls.find((c) => c.head)?.filters
    expect(window).toMatchObject({ 'eq:source': 'application', 'gte:created_at': '2026-11-09T23:00:00.000Z' })
  })

  it('answers a repeat email like a new one, and writes nothing for a bot', async () => {
    h.respond = respondWith({ upline: 'up-1', insertError: { message: 'dup', code: '23505' } })
    await expect(submitApplication(input(), HASH, NOW)).resolves.toBeUndefined()
    h.calls = []
    await submitApplication(input({ isBot: true }), HASH, NOW)
    expect(h.calls).toEqual([])
  })

  it('never trusts the visitor-typed left end of x-forwarded-for', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFrom(new Headers({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' }))).toBe('198.51.100.7')
    expect(clientIpFrom(new Headers())).toBe('unknown')
  })

  it('hashes the IP with a key, never storing it as typed', () => {
    const before = process.env.DISTRIBUTOR_APPLY_IP_KEY
    process.env.DISTRIBUTOR_APPLY_IP_KEY = 'k1'
    const a = hashApplicantIp('203.0.113.9')
    process.env.DISTRIBUTOR_APPLY_IP_KEY = 'k2'
    expect(hashApplicantIp('203.0.113.9')).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('203')
    if (before === undefined) delete process.env.DISTRIBUTOR_APPLY_IP_KEY
    else process.env.DISTRIBUTOR_APPLY_IP_KEY = before
  })
})

describe('POST /api/partner/apply', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    POST(new Request('https://app.test/api/partner/apply', { method: 'POST', body, headers: { origin: 'https://app.test', host: 'app.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9', ...headers } }))

  beforeEach(() => { process.env.DISTRIBUTOR_APPLY_IP_KEY = 'test-key' })

  it('refuses another site and oversized bodies before touching the database', async () => {
    expect((await post(JSON.stringify(BODY), { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(JSON.stringify({ ...BODY, note: '字'.repeat(3000) }))).status).toBe(413)
    expect(h.calls).toEqual([])
  })

  it('returns the first reason for a bad form, 201 for a good one', async () => {
    const bad = await post(JSON.stringify({ ...BODY, accept_terms: false }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('请先阅读并勾选同意经销商条款')
    h.respond = respondWith({ upline: 'up-1' })
    const ok = await post(JSON.stringify(BODY))
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ ok: true })
  })
})

describe('terms', () => {
  it('quotes the rates the engine actually pays and promises no income', () => {
    const text = distributorTerms().flatMap((s) => s.points).join('\n')
    expect(text).toContain('普通经销商 20%，一级 30%，特级 35%')
    expect(text).toContain('5%')
    expect(text).toContain('不收加盟费')
    expect(text).toContain('不保证任何收入')
  })
})
