import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null, throwSession: false }))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () => {
    if (h.throwSession) throw new Error('session store down')
    return h.email
      ? { ok: true, user: { id: 'u-pm', email: h.email } }
      : { ok: false, status: 401, error: 'Unauthorized' }
  },
}))

import { requireSpendActivationAuthority, buildSpendActivationReceipt } from '@/lib/ads/spend-activation'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT = 'aaaaaaaa-0000-0000-0000-000000000001'

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.ADMIN_EMAILS = 'pm@magiclab.test'
  process.env.ADMIN_EMAIL_DOMAIN = 'staff.magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT}`
  h.email = null
  h.throwSession = false
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('requireSpendActivationAuthority', () => {
  it('no session → 401 denied', async () => {
    h.email = null
    const result = await requireSpendActivationAuthority()
    expect(result).toMatchObject({ ok: false, status: 401, code: 'activation_requires_pm' })
  })

  it('scoped demo admin → 403 denied', async () => {
    h.email = 'demo@x.test'
    const result = await requireSpendActivationAuthority()
    expect(result).toMatchObject({ ok: false, status: 403, code: 'activation_requires_pm' })
  })

  it('domain-only admin → 403 denied (only exact ADMIN_EMAILS counts)', async () => {
    h.email = 'someone@staff.magiclab.test'
    const result = await requireSpendActivationAuthority()
    expect(result).toMatchObject({ ok: false, status: 403, code: 'activation_requires_pm' })
  })

  it('client viewer → 403 denied', async () => {
    process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT}`
    h.email = 'viewer@x.test'
    const result = await requireSpendActivationAuthority()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('empty ADMIN_EMAILS → denied even for a domain admin', async () => {
    delete process.env.ADMIN_EMAILS
    h.email = 'pm@staff.magiclab.test'
    const result = await requireSpendActivationAuthority()
    expect(result.ok).toBe(false)
  })

  it('session lookup throws → 500 denied', async () => {
    h.throwSession = true
    h.email = 'pm@magiclab.test'
    const result = await requireSpendActivationAuthority()
    expect(result).toMatchObject({ ok: false, status: 500, code: 'activation_auth_failed' })
  })

  it('exact ADMIN_EMAILS member → allowed with actor identity', async () => {
    h.email = 'PM@MagicLab.test'
    const result = await requireSpendActivationAuthority()
    expect(result).toEqual({
      ok: true,
      actorUserId: 'u-pm',
      actorEmail: 'pm@magiclab.test',
      basis: 'global_admin',
    })
  })
})

describe('buildSpendActivationReceipt', () => {
  it('carries who, which client, which campaign, basis and time', () => {
    const receipt = buildSpendActivationReceipt({
      authority: { actorUserId: 'u-pm', actorEmail: 'pm@magiclab.test', basis: 'global_admin' },
      entry: 'meta-ads/execute',
      clientId: 'c1',
      campaignId: '120',
      now: new Date('2026-10-06T01:02:03.000Z'),
    })
    expect(receipt).toEqual({
      schema: 'ads.spend_activation_receipt.v1',
      entry: 'meta-ads/execute',
      basis: 'global_admin',
      actor_user_id: 'u-pm',
      actor_email: 'pm@magiclab.test',
      client_id: 'c1',
      campaign_id: '120',
      draft_action_id: null,
      authorized_at: '2026-10-06T01:02:03.000Z',
    })
    expect(receipt).not.toHaveProperty('card_run_id')
  })

  it('records the confirmation-card run only for a go-live click', () => {
    const receipt = buildSpendActivationReceipt({
      authority: {
        actorUserId: 'u-fde',
        actorEmail: 'fde@example.com',
        basis: 'go_live_card',
        cardRunId: '11111111-1111-4111-8111-111111111111',
      },
      entry: 'go-live-card',
      clientId: 'c1',
      campaignId: '120',
      now: new Date('2026-10-28T01:00:00.000Z'),
    })
    expect(receipt.basis).toBe('go_live_card')
    expect(receipt.entry).toBe('go-live-card')
    expect(receipt.card_run_id).toBe('11111111-1111-4111-8111-111111111111')
  })
})

