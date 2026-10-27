import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphCustomAudience, GraphReadResult } from '@/lib/meta/entity-settings'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadOwnedAccounts: vi.fn() }))
vi.mock('@/lib/marketing-plan/promo/playbooks', () => ({ resolvePromoPlaybook: vi.fn() }))
vi.mock('@/lib/ads-strategy/promo-draft-facts', () => ({ loadAdsDraftFacts: vi.fn() }))
vi.mock('@/lib/meta/lead-forms', () => ({ fetchPageLeadForms: vi.fn() }))
vi.mock('@/lib/meta/graph-base', () => ({ GRAPH_BASE: 'https://graph.example.test/v99.0' }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({
  getStoredPageToken: vi.fn(),
  resolveMetaTokenForClient: vi.fn(async () => ({ token: 'tok', source: 'client_db' })),
}))
vi.mock('@/lib/meta/entity-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta/entity-settings')>()
  return { ...actual, fetchCustomAudienceById: vi.fn() }
})

import { fetchCustomAudienceById } from '@/lib/meta/entity-settings'
import { readAudienceStatusProd } from '../deps'

function audience(accountId: string | undefined): GraphReadResult<GraphCustomAudience & { account_id?: string }> {
  return { rows: [{ id: '111', account_id: accountId, operation_status: { code: 200 }, delivery_status: { code: 200 } }], complete: true, error: null }
}

describe('readAudienceStatusProd account check', () => {
  beforeEach(() => { vi.mocked(fetchCustomAudienceById).mockReset() })

  it.each([
    ['the step account', '123', { '111': { operation: 200, delivery: 200 } }],
    ['a different ad account', '999', {}],
    ['an audience Meta does not assign to an account', undefined, {}],
  ] as const)('keeps only an audience owned by %s', async (_label, accountId, value) => {
    vi.mocked(fetchCustomAudienceById).mockResolvedValue(audience(accountId))
    await expect(readAudienceStatusProd('c1', ['111'], 'act_123')).resolves.toEqual({ state: 'ok', value })
  })
})
