/**
 * AD-SEC-4 — staff binding a Facebook Page: Meta check → cross-client duplicate
 * check (no override) → audit first, fail closed → write → audit applied.
 * Route-level auth (client staff refused) is in app/api/clients/[id]/facebook-page.
 *
 * Table-modelled fake DB so "excluding this client" and dirty stored values are
 * really exercised, and the column is checked for what actually got written.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBindingFakeDb, type FakeDb, type FakeFailures } from './binding-fake-db'

const state: { db: FakeDb; failures: FakeFailures } = { db: {}, failures: {} }
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeBindingFakeDb(state.db, state.failures).from(t) },
}))
vi.mock('../token-manager', () => ({ getStoredPageToken: vi.fn(), resolveMetaTokenForClient: vi.fn() }))
vi.mock('../page-posts', () => ({ listManagedPages: vi.fn() }))

import { bindPage, clearPage } from '../page-binding-service'
import { pageIdMatches, normalisePageId } from '../page-binding'
import { getStoredPageToken, resolveMetaTokenForClient } from '../token-manager'
import { listManagedPages } from '../page-posts'

const mockStored = vi.mocked(getStoredPageToken)
const mockToken = vi.mocked(resolveMetaTokenForClient)
const mockPages = vi.mocked(listManagedPages)

const A = 'client-a'
const B = 'client-b'
const PAGE = '1616575215312482'
const STAFF = 'fde@magiclab.example'

const column = (id: string) => state.db.clients.find((c) => c.id === id)?.facebook_page_id
const audits = () => state.db.client_binding_audit ?? []

beforeEach(() => {
  state.db = {
    clients: [
      { id: A, name: 'Client A', facebook_page_id: '555555555555' },
      { id: B, name: 'Client B', facebook_page_id: null },
    ],
    client_binding_audit: [],
  }
  state.failures = {}
  mockStored.mockResolvedValue(null)
  mockToken.mockResolvedValue({ token: 'shared', source: 'shared_fallback' })
  mockPages.mockResolvedValue([{ id: PAGE, name: 'Client A Page' }])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('bindPage — staff save', () => {
  it('succeeds: writes the column and leaves an authorized→applied audit row with who / what / from what', async () => {
    const res = await bindPage(A, STAFF, PAGE)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, page_id: PAGE, page: { id: PAGE, name: 'Client A Page' }, token_source: 'shared_fallback' })
    expect(column(A)).toBe(PAGE)
    expect(audits()).toHaveLength(1)
    expect(audits()[0]).toMatchObject({
      client_id: A, binding_kind: 'facebook_page', actor_email: STAFF, action: 'bind', outcome: 'applied',
      previous_value: '555555555555', requested_value: PAGE, token_source: 'shared_fallback',
    })
  })

  it('a stored OAuth connection for this client + Page verifies without asking Meta for the list', async () => {
    mockStored.mockResolvedValue('oauth-page-token')
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(200)
    expect(mockPages).not.toHaveBeenCalled()
    expect(audits()[0]).toMatchObject({ token_source: 'client_oauth', outcome: 'applied' })
  })
})

describe('bindPage — refused, column untouched', () => {
  it('Page already bound to another client (stored dirty) → 409, audited, no override exists', async () => {
    state.db.clients[1].facebook_page_id = ` ${PAGE}​`

    const res = await bindPage(A, STAFF, PAGE)

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ reason: 'page_bound_to_other_client', bound_to: [{ client_id: B, client_name: 'Client B' }] })
    expect(column(A)).toBe('555555555555')
    expect(audits()).toEqual([expect.objectContaining({ outcome: 'rejected_duplicate', shared_with_client_ids: [B] })])
  })

  it('re-saving this client\'s own Page is not a duplicate of itself', async () => {
    state.db.clients[0].facebook_page_id = PAGE
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(200)
  })

  it('Meta does not list the Page for this client → 422', async () => {
    mockPages.mockResolvedValue([{ id: '999999999999', name: 'Someone else' }])
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(422)
    expect(column(A)).toBe('555555555555')
    expect(audits()).toEqual([expect.objectContaining({ outcome: 'rejected_graph' })])
  })

  it('Meta cannot be asked → 502, not saved', async () => {
    mockPages.mockResolvedValue(null)
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(502)
    expect(column(A)).toBe('555555555555')
  })

  it('no token and no OAuth connection → 424', async () => {
    mockToken.mockResolvedValue(null)
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(424)
    expect(column(A)).toBe('555555555555')
    expect(audits()).toEqual([expect.objectContaining({ outcome: 'rejected_no_token' })])
  })

  it('duplicate check cannot read → 500, not saved (unknown ≠ no duplicate)', async () => {
    state.failures = { select: new Set(['clients']) }
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ reason: 'duplicate_check_failed' })
    expect(column(A)).toBe('555555555555')
  })

  it('audit row cannot be written → 500, not saved (fail closed)', async () => {
    state.failures = { insert: new Set(['client_binding_audit']) }
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ reason: 'audit_unavailable' })
    expect(column(A)).toBe('555555555555')
  })

  it('column write fails → 500 and the audit row says write_failed', async () => {
    state.failures = { update: new Set(['clients']) }
    const res = await bindPage(A, STAFF, PAGE)
    expect(res.status).toBe(500)
    expect(audits()[0]).toMatchObject({ outcome: 'write_failed' })
  })
})

describe('clearPage', () => {
  it('nulls the column with an audited clear', async () => {
    const res = await clearPage(A, STAFF)
    expect(res.status).toBe(200)
    expect(column(A)).toBeNull()
    expect(audits()[0]).toMatchObject({ action: 'clear', outcome: 'applied', previous_value: '555555555555', requested_value: null })
  })

  it('audit cannot be written → not cleared', async () => {
    state.failures = { insert: new Set(['client_binding_audit']) }
    const res = await clearPage(A, STAFF)
    expect(res.status).toBe(500)
    expect(column(A)).toBe('555555555555')
  })
})

describe('page id helpers', () => {
  it.each([PAGE, ` ${PAGE} `, `0${PAGE}`, `１６１６５７５２１５３１２４８２`, `1616​575215312482`, `111111111,${PAGE}`])(
    'stored %j matches', (stored) => {
      expect(pageIdMatches(stored, PAGE)).toBe(true)
    },
  )

  it.each([`${PAGE}9`, '999999999999', '', 'abc'])('stored %j does not match', (stored) => {
    expect(pageIdMatches(stored, PAGE)).toBe(false)
  })

  it('normalisePageId keeps the old input rules', () => {
    expect(normalisePageId(`  ${PAGE} `)).toBe(PAGE)
    expect(normalisePageId('')).toBeNull()
    expect(() => normalisePageId('facebook.com/CTSTOURS')).toThrow()
    expect(() => normalisePageId('１６１６５７５２１５３１２４８２')).toThrow()
  })
})
