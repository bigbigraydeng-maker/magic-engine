/**
 * Listing upload and the paused build wait for a confirmed card.
 * No card, an expired card, or an unconfirmed card does not call Meta.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardClicker, ConfirmationCardView } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { PAUSED_DRAFT_WHAT } from '../paused-draft-copy'
import {
  confirmListingDraftCard,
  issueListingDraftCard,
  type ListingIntent,
} from '../listing-draft-card'

const CLIENT = 'client-1'
const FP = 'a'.repeat(64)
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }

const intent: ListingIntent = {
  kind: 'lead_form',
  lang: 'en',
  listingId: 'listing-1',
  assetIds: ['asset-1'],
  listing: null,
  agent: { displayName: 'Agent', achievements: [], sourceUrl: 'https://example.test/agent' },
  dailyBudget: 1,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'page-1',
  adAccountId: 'act_test',
  country: 'NZ',
  industry: null,
}

function view(status: ConfirmationCardView['status']): ConfirmationCardView {
  return {
    runId: 'run-1',
    expectedDecisionId: '11111111-1111-4111-8111-111111991111',
    fingerprint: FP,
    what: PAUSED_DRAFT_WHAT,
    account: '已登记的广告账户',
    amount: '确认之后才上传并建成暂停',
    date: '从点确认当天算起',
    scope: '先上传这套房的素材，再建成一个暂停系列，不开启',
    expiresLabel: '很快过期',
    status,
    statusLine: status === 'expired' ? '过了 30 分钟没人点，这张卡作废了。' : '还没人点。',
    confirmEnabled: false,
    declineEnabled: false,
    blockedReason: null,
  }
}

interface HoldRow {
  id: string
  client_id: string
  action_type: string
  payload: {
    status: string
    cardRunId: string
    fingerprint: string
    subjectKey: string
    intent: ListingIntent
    wroteMeta: boolean
  }
}

function memory() {
  const rows: HoldRow[] = []
  let n = 0
  const sb = {
    from(table: string) {
      const filters: Array<[string, string]> = []
      let inserted: Omit<HoldRow, 'id'> | null = null
      let patch: { payload: HoldRow['payload'] } | null = null
      const api = {
        select: () => api,
        eq(col: string, val: string) { filters.push([col, val]); return api },
        insert(row: Omit<HoldRow, 'id'>) { inserted = row; return api },
        update(row: { payload: HoldRow['payload'] }) { patch = row; return api },
        maybeSingle: () => Promise.resolve(finish()),
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve(finish()).then(resolve),
      }
      function finish() {
        if (table !== 'flywheel_actions') return { data: null, error: { message: 'unread' } }
        if (inserted) {
          rows.push({ id: `row-${++n}`, ...inserted })
          return { data: { id: rows[rows.length - 1]?.id }, error: null }
        }
        const matched = rows.filter((row) => filters.every(([col, val]) => matches(row, col, val)))
        if (!patch) return { data: matched, error: null }
        if (matched.length !== 1 || !matched[0]) return { data: [], error: null }
        matched[0].payload = patch.payload
        return { data: [{ id: matched[0].id }], error: null }
      }
      return api
    },
  }
  return { sb: sb as unknown as SupabaseClient, rows }
}

function matches(row: HoldRow, col: string, val: string): boolean {
  if (col === 'id') return row.id === val
  if (col === 'client_id') return row.client_id === val
  if (col === 'action_type') return row.action_type === val
  if (col === 'payload->>cardRunId') return row.payload.cardRunId === val
  if (col === 'payload->>subjectKey') return row.payload.subjectKey === val
  if (col === 'payload->>status') return row.payload.status === val
  return false
}

function deps(status: ConfirmationCardView['status'] = 'confirmed') {
  return {
    issue: vi.fn(async () => view('waiting')),
    decide: vi.fn(async () => view(status)),
  }
}

async function issued(store: ReturnType<typeof memory>, used = deps()) {
  const card = await issueListingDraftCard({
    sb: store.sb,
    clientId: CLIENT,
    clicker: { kind: 'agent', email: 'staff@example.com' },
    intent,
    accountLabel: '已登记的广告账户',
    deps: used,
  })
  return card
}

describe('listing draft card', () => {
  it('asking does not upload or build', async () => {
    const perform = vi.fn()
    const store = memory()
    const card = await issued(store)
    expect(card.what).toBe(PAUSED_DRAFT_WHAT)
    expect(perform).not.toHaveBeenCalled()
    expect(store.rows[0]?.payload.wroteMeta).toBe(false)
  })

  it('no card does not upload', async () => {
    const perform = vi.fn()
    const store = memory()
    const result = await confirmListingDraftCard({
      sb: store.sb,
      clientId: CLIENT,
      runId: 'missing',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: view('waiting').expectedDecisionId,
      fingerprint: FP,
      deps: deps(),
      perform,
    })
    expect(result).toEqual({ handled: false })
    expect(perform).not.toHaveBeenCalled()
  })

  it('an expired, waiting, or declined card does not upload', async () => {
    for (const status of ['expired', 'waiting', 'voided'] as const) {
      const store = memory()
      const used = deps(status)
      const card = await issued(store, used)
      const perform = vi.fn()
      const result = await confirmListingDraftCard({
        sb: store.sb,
        clientId: CLIENT,
        runId: card.runId,
        clicker: OPC,
        resolution: 'confirm',
        expectedDecisionId: card.expectedDecisionId,
        fingerprint: card.fingerprint,
        deps: used,
        perform,
      })
      expect(perform).not.toHaveBeenCalled()
      if (result.handled) expect(result.body.wroteMeta).toBe(false)
    }
    const store = memory()
    const used = deps('declined')
    const card = await issued(store, used)
    const perform = vi.fn()
    const declined = await confirmListingDraftCard({
      sb: store.sb,
      clientId: CLIENT,
      runId: card.runId,
      clicker: OPC,
      resolution: 'decline',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      deps: used,
      perform,
    })
    expect(perform).not.toHaveBeenCalled()
    expect(declined.handled && declined.body.wroteMeta).toBe(false)
  })

  it('an agent cannot press the card', async () => {
    const store = memory()
    const card = await issued(store)
    const perform = vi.fn()
    await expect(confirmListingDraftCard({
      sb: store.sb,
      clientId: CLIENT,
      runId: card.runId,
      clicker: AGENT,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      deps: deps(),
      perform,
    })).rejects.toBeInstanceOf(ConfirmationCardError)
    expect(perform).not.toHaveBeenCalled()
  })

  it('a confirmed card uploads once', async () => {
    const store = memory()
    const used = deps('confirmed')
    const card = await issued(store, used)
    const perform = vi.fn(async () => ({ wroteMeta: true }))
    const result = await confirmListingDraftCard({
      sb: store.sb,
      clientId: CLIENT,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      deps: used,
      perform,
    })
    expect(perform).toHaveBeenCalledTimes(1)
    expect(result.handled && result.body.wroteMeta).toBe(true)
    const again = await confirmListingDraftCard({
      sb: store.sb,
      clientId: CLIENT,
      runId: card.runId,
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: card.expectedDecisionId,
      fingerprint: card.fingerprint,
      deps: used,
      perform,
    })
    expect(perform).toHaveBeenCalledTimes(1)
    expect(again.handled && again.body.wroteMeta).toBe(false)
  })

  it('the ask route does not upload or build', () => {
    const source = readFileSync('src/app/api/clients/[id]/meta-ads/draft-listing/route.ts', 'utf8')
    expect(source).not.toContain('uploadAssetToMeta')
    expect(source).not.toContain('createDraftForApproval')
    const admit = readFileSync('src/lib/ads-strategy/admit-finished-asset.ts', 'utf8')
    expect(admit).not.toContain('createDraftForApproval')
    expect(admit).not.toContain('setCampaignStatus')
  })
})
