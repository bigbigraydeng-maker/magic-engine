/**
 * Direct paused-ad create only asks for the existing card.
 * No card, an expired card, or an unconfirmed card does not build.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker, ConfirmationCardView } from '@/lib/confirmation-card'
import { assertMayClick } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { AdDraft } from '../ad-draft'
import { askerFromAccess } from '../card-asker'
import { askDirectPausedDraft } from '../direct-draft-card'
import { issuePausedDraftCard, submitPausedDraftCard } from '../paused-draft-submit'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const REVIEW = {
  adAccountId: 'act_test',
  accounts: [{
    ad_account_id: 'act_test',
    currency: 'NZD',
    daily_cap_cents: 10000,
    owned_by_client: true,
  }],
  clientCapCents: 20000,
}

function draft(): AdDraft {
  return {
    kind: 'lead_form',
    clientId: CLIENT_A,
    campaignName: 'lead campaign',
    adSetName: 'group',
    dailyBudget: 30,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page-1',
    leadFormId: 'form-1',
    creatives: [{ name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }],
  }
}

function fixture() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-10-27T00:00:00.000Z',
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
  })
}

describe('direct paused draft asks, then the existing card builds', () => {
  it('several ad sets do not get the single-set card and do not build', async () => {
    const issue = vi.fn()
    const result = await askDirectPausedDraft({ draft: { adSets: [{ name: 'a' }, { name: 'b' }] }, issue })
    expect(result.status).toBe(409)
    expect(result.body.wroteMeta).toBe(false)
    expect(issue).not.toHaveBeenCalled()
  })

  it('one ad set only issues the card', async () => {
    const issue = vi.fn(async (): Promise<ConfirmationCardView> => ({ runId: 'run-1' } as ConfirmationCardView))
    const result = await askDirectPausedDraft({ draft: {}, issue })
    expect(result).toMatchObject({ status: 202, body: { wroteMeta: false, status: 'awaiting_confirmation' } })
    expect(issue).toHaveBeenCalledTimes(1)
  })

  it('a paid client may ask, and cannot press the card', () => {
    const clicker = askerFromAccess({
      ok: true,
      user: { id: 'u', email: 'staff@example.com' } as never,
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: CLIENT_A,
    }, CLIENT_A, false)
    expect(clicker).toEqual({ kind: 'agent', email: 'staff@example.com' })
    expect(() => assertMayClick(clicker, CLIENT_A)).toThrow(ConfirmationCardError)
  })

  it('no card, an expired card, or a declined card does not build', async () => {
    const f = fixture()
    const createPaused = vi.fn(async () => ({ actionId: 'a', status: 'awaiting_approval' as const, summary: 's', findings: [] }))
    const missing = submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: '00000000-0000-4000-8000-000000990099',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: '00000000-0000-4000-8000-000000990098',
      fingerprint: 'a'.repeat(64),
      review: REVIEW,
      createPaused,
    })
    await expect(missing).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(createPaused).not.toHaveBeenCalled()

    const card = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: draft(),
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })
    const declined = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: card.runId,
      clicker: OPC,
      resolution: 'decline',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      review: REVIEW,
      createPaused,
    })
    expect(declined.wroteMeta).toBe(false)
    expect(createPaused).not.toHaveBeenCalled()

    const second = await issuePausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      draft: { ...draft(), campaignName: 'other campaign' },
      accountLabel: '这位客户的广告账户',
      review: REVIEW,
    })
    const expired = await submitPausedDraftCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: second.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: second.expectedDecisionId,
      fingerprint: second.fingerprint,
      review: REVIEW,
      createPaused,
      now: new Date('2026-10-27T00:31:00.000Z'),
    })
    expect(expired.wroteMeta).toBe(false)
    expect(createPaused).not.toHaveBeenCalled()
  })

  it('the direct route does not import the builder', () => {
    const source = readFileSync('src/app/api/clients/[id]/meta-ads/draft/route.ts', 'utf8')
    expect(source).not.toContain('createDraftForApproval')
    expect(source).not.toContain('draft-and-gate')
  })
})
