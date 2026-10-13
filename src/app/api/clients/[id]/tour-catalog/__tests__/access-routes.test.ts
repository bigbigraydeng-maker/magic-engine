import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess: vi.fn() }))
vi.mock('@/lib/tour-catalog/store', () => ({
  loadDraftCatalog: vi.fn(),
  listRecentBatches: vi.fn(),
  getClientDomain: vi.fn(),
  getDraftRevision: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/store-access', () => ({
  getClientName: vi.fn(),
  getPendingPublishRequest: vi.fn(),
  getSettings: vi.fn(),
  listMemberEmails: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  saveSettings: vi.fn(),
  upsertPublishRequest: vi.fn(),
}))

import { GET as catalogGET } from '../route'
import { GET as membersGET, POST as membersPOST, DELETE as membersDELETE } from '../members/route'
import { PUT as settingsPUT } from '../settings/route'
import { POST as publishRequestPOST } from '../publish-requests/route'

import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import {
  loadDraftCatalog,
  listRecentBatches,
  getClientDomain,
  getDraftRevision,
} from '@/lib/tour-catalog/store'
import {
  getClientName,
  getPendingPublishRequest,
  getSettings,
  listMemberEmails,
  listMembers,
  addMember,
  removeMember,
  saveSettings,
  upsertPublishRequest,
} from '@/lib/tour-catalog/store-access'
import { adminAccess, editorAccess } from './access-fixtures'

const mockedRequireAccess = vi.mocked(requireCatalogAccess)
const mockedLoadDraftCatalog = vi.mocked(loadDraftCatalog)
const mockedListRecentBatches = vi.mocked(listRecentBatches)
const mockedGetClientDomain = vi.mocked(getClientDomain)
const mockedGetDraftRevision = vi.mocked(getDraftRevision)
const mockedGetClientName = vi.mocked(getClientName)
const mockedGetPendingPublishRequest = vi.mocked(getPendingPublishRequest)
const mockedGetSettings = vi.mocked(getSettings)
const mockedListMemberEmails = vi.mocked(listMemberEmails)
const mockedListMembers = vi.mocked(listMembers)
const mockedAddMember = vi.mocked(addMember)
const mockedRemoveMember = vi.mocked(removeMember)
const mockedSaveSettings = vi.mocked(saveSettings)
const mockedUpsertPublishRequest = vi.mocked(upsertPublishRequest)

const CLIENT_ID = 'client-1'
const CONTEXT = { params: Promise.resolve({ id: CLIENT_ID }) }

const DEFAULT_SETTINGS = {
  logoUrl: null,
  brandPrimary: null,
  brandSecondary: null,
  channelsConnected: false,
  imageHosts: [],
}

const SNAPSHOT = {
  tours: [
    {
      id: 't1',
      name: 'Golden China',
      heroImage: 'https://img.example-cdn.com/hero.jpg',
      gallery: ['/images/tours/a.jpg', 'https://img.example-cdn.com/hero.jpg', 'https://www.ctstours.co.nz/b.jpg'],
      itinerary: [{ day: 1, title: 'Arrive', description: '', operatorLogo: { src: 'https://logos.example.org/air.png', alt: 'Air' } }],
    },
  ],
  departures: [
    {
      id: 'd1',
      tourId: 't1',
      departOn: '2027-03-11',
      status: 'open',
      internal: { airline: 'SECRET-AIR', capacity: 20 },
    },
  ],
  aliases: [{ aliasNorm: 'golden', tourId: 't1' }],
}

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function rawRequest(url: string, method: string, body: string): NextRequest {
  return new NextRequest(url, {
    method,
    body,
    headers: { 'content-type': 'application/json' },
  })
}

function deniedResponse(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockedRequireAccess.mockResolvedValue(adminAccess('admin@example.com'))
  mockedLoadDraftCatalog.mockResolvedValue(SNAPSHOT as never)
  mockedListRecentBatches.mockResolvedValue([{ id: 'batch-1' }] as never)
  mockedGetClientDomain.mockResolvedValue('ctstours.co.nz')
  mockedGetClientName.mockResolvedValue('CTS Tours')
  mockedGetSettings.mockResolvedValue({ ...DEFAULT_SETTINGS })
  mockedGetPendingPublishRequest.mockResolvedValue(null)
  mockedListMemberEmails.mockResolvedValue(new Set(['staff@cts.example']))
  mockedListMembers.mockResolvedValue([])
  mockedGetDraftRevision.mockResolvedValue(54)
})

describe('GET catalog — trimmed by permission', () => {
  it('returns the full snapshot for an admin', async () => {
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tours).toEqual(SNAPSHOT.tours)
    expect(body.departures[0].internal).toEqual({ airline: 'SECRET-AIR', capacity: 20 })
    expect(body.aliases).toEqual(SNAPSHOT.aliases)
    expect(body.batches).toEqual([{ id: 'batch-1' }])
    expect(body.domain).toBe('ctstours.co.nz')
    expect(body.clientName).toBe('CTS Tours')
    expect(body.viewer).toEqual({ email: 'admin@example.com', role: 'me_admin' })
    expect(body.permissions.publish).toBe(true)
    expect(body.settings).toEqual(DEFAULT_SETTINGS)
    expect(body.pendingPublishRequest).toBeNull()
    // Every image address the draft uses, de-duplicated and sorted.
    expect(body.imagePool).toEqual([
      '/images/tours/a.jpg',
      'https://img.example-cdn.com/hero.jpg',
      'https://logos.example.org/air.png',
      'https://www.ctstours.co.nz/b.jpg',
    ])
    // Hosts seen in those images that are neither on the allow-list nor the client's own domain.
    expect(body.imageHostSuggestions).toEqual([
      { host: 'img.example-cdn.com', count: 2 },
      { host: 'logos.example.org', count: 1 },
    ])
  })

  it('leaves hosts already on the allow-list out of the suggestions', async () => {
    mockedGetSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, imageHosts: ['img.example-cdn.com'] })
    const res = await catalogGET(new NextRequest('http://localhost/api/clients/client-1/tour-catalog'), CONTEXT)
    const body = await res.json()
    expect(body.settings.imageHosts).toEqual(['img.example-cdn.com'])
    expect(body.imageHostSuggestions).toEqual([{ host: 'logos.example.org', count: 1 }])
  })

  it('gives a client editor the image pool but never the host suggestions', async () => {
    mockedRequireAccess.mockResolvedValue(editorAccess('staff@cts.example'))
    const res = await catalogGET(new NextRequest('http://localhost/api/clients/client-1/tour-catalog'), CONTEXT)
    const body = await res.json()
    expect(body.imagePool).toHaveLength(4)
    expect('imageHostSuggestions' in body).toBe(false)
    expect(body.permissions.edit_site).toBe(false)
  })

  it('trims internal facts, aliases and batches for a client editor', async () => {
    mockedRequireAccess.mockResolvedValue(editorAccess('staff@cts.example'))
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('SECRET-AIR')
    const body = JSON.parse(text)
    expect(body.departures[0].internal).toEqual({})
    expect(body.aliases).toEqual([])
    expect(body.batches).toEqual([])
    expect(mockedListRecentBatches).not.toHaveBeenCalled()
    expect(body.viewer).toEqual({ email: 'staff@cts.example', role: 'client_editor' })
    expect(body.permissions.publish).toBe(false)
    expect(body.permissions.edit).toBe(true)
    expect(body.departures[0].id).toBe('d1')
    expect(body.departures[0].departOn).toBe('2027-03-11')
    expect(body.departures[0].status).toBe('open')
  })

  it('normalises the stored domain and passes null through', async () => {
    mockedGetClientDomain.mockResolvedValue('https://www.CTSTours.co.nz/')
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    const body = await res.json()
    expect(body.domain).toBe('ctstours.co.nz')

    mockedGetClientDomain.mockResolvedValue(null)
    const res2 = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    const body2 = await res2.json()
    expect(body2.domain).toBeNull()
  })

  it('returns the pending request as stored for an admin', async () => {
    const pending = {
      id: 'r1',
      requestedBy: 'staff@cts.example',
      note: 'n',
      createdAt: 't',
      draftVersion: 54,
    }
    mockedGetPendingPublishRequest.mockResolvedValue(pending)
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    const body = await res.json()
    expect(body.pendingPublishRequest).toEqual(pending)
  })

  it('masks a non-member requester for a client editor', async () => {
    mockedRequireAccess.mockResolvedValue(editorAccess('staff@cts.example'))

    mockedGetPendingPublishRequest.mockResolvedValue({
      id: 'r1',
      requestedBy: 'staff@cts.example',
      note: 'n',
      createdAt: 't',
      draftVersion: 54,
    })
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    const body = await res.json()
    expect(body.pendingPublishRequest.requestedBy).toBe('staff@cts.example')

    mockedGetPendingPublishRequest.mockResolvedValue({
      id: 'r2',
      requestedBy: 'admin@example.com',
      note: 'n',
      createdAt: 't',
      draftVersion: 54,
    })
    const res2 = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    const text2 = await res2.text()
    expect(text2).not.toContain('admin@example.com')
    const body2 = JSON.parse(text2)
    expect(body2.pendingPublishRequest.requestedBy).toBe('Magic Engine 团队')
  })

  it('returns 403 and does no work when access is denied', async () => {
    mockedRequireAccess.mockResolvedValue(deniedResponse())
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    expect(res.status).toBe(403)
    expect(mockedLoadDraftCatalog).not.toHaveBeenCalled()
    expect(mockedGetSettings).not.toHaveBeenCalled()
    expect(mockedGetClientName).not.toHaveBeenCalled()
  })

  it('returns 500 when the catalog load fails', async () => {
    mockedLoadDraftCatalog.mockRejectedValue(new Error('relation "x" does not exist'))
    const res = await catalogGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog'),
      CONTEXT,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'catalog_load_failed' })
  })
})

describe('members', () => {
  it('GET returns the member list', async () => {
    const member = {
      email: 'staff@cts.example',
      grantedBy: 'admin@example.com',
      createdAt: 't',
      hasLogin: true,
    }
    mockedListMembers.mockResolvedValue([member])
    const res = await membersGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog/members'),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ members: [member] })
    expect(mockedListMembers).toHaveBeenCalledWith({}, CLIENT_ID)
  })

  it('POST normalises the email and records the session actor', async () => {
    const res = await membersPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        { email: '  Staff@CTS.Example ' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(mockedAddMember).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      'staff@cts.example',
      'admin@example.com',
    )
    expect(await res.json()).toEqual({ members: [] })
  })

  it('POST ignores a grantedBy field in the body', async () => {
    await membersPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        { email: 'staff@cts.example', grantedBy: 'someone@else' },
      ),
      CONTEXT,
    )
    expect(mockedAddMember).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      'staff@cts.example',
      'admin@example.com',
    )
  })

  it('POST rejects invalid emails', async () => {
    const bodies: unknown[] = ['', 'no-at', 'a@b', 42, {}]
    for (const body of bodies) {
      const res = await membersPOST(
        jsonRequest(
          'http://localhost/api/clients/client-1/tour-catalog/members',
          'POST',
          body,
        ),
        CONTEXT,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_email' })
    }
    expect(mockedAddMember).not.toHaveBeenCalled()
  })

  it('POST rejects invalid JSON and oversized bodies', async () => {
    const bad = await membersPOST(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        '{nope',
      ),
      CONTEXT,
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_json' })

    const big = await membersPOST(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        'x'.repeat(64 * 1024 + 1),
      ),
      CONTEXT,
    )
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'request_too_large' })
    expect(mockedAddMember).not.toHaveBeenCalled()
  })

  it('DELETE normalises the email and rejects a missing one', async () => {
    const res = await membersDELETE(
      new NextRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members?email=Staff@CTS.Example',
        { method: 'DELETE' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(mockedRemoveMember).toHaveBeenCalledWith({}, CLIENT_ID, 'staff@cts.example')

    const missing = await membersDELETE(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog/members', {
        method: 'DELETE',
      }),
      CONTEXT,
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'invalid_email' })
  })

  it('POST returns 500 when addMember fails', async () => {
    mockedAddMember.mockRejectedValue(new Error('duplicate key value violates unique constraint'))
    const res = await membersPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        { email: 'staff@cts.example' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'members_failed' })
  })

  it('denies GET, POST and DELETE without touching the store', async () => {
    mockedRequireAccess.mockResolvedValue(deniedResponse())

    const get = await membersGET(
      new NextRequest('http://localhost/api/clients/client-1/tour-catalog/members'),
      CONTEXT,
    )
    expect(get.status).toBe(403)

    const post = await membersPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members',
        'POST',
        { email: 'staff@cts.example' },
      ),
      CONTEXT,
    )
    expect(post.status).toBe(403)

    const del = await membersDELETE(
      new NextRequest(
        'http://localhost/api/clients/client-1/tour-catalog/members?email=staff@cts.example',
        { method: 'DELETE' },
      ),
      CONTEXT,
    )
    expect(del.status).toBe(403)

    expect(mockedListMembers).not.toHaveBeenCalled()
    expect(mockedAddMember).not.toHaveBeenCalled()
    expect(mockedRemoveMember).not.toHaveBeenCalled()
  })
})

describe('settings', () => {
  const VALID_BODY = {
    logoUrl: 'https://www.ctstours.co.nz/logo.png',
    brandPrimary: '#B61E2E',
    brandSecondary: '#D6A756',
    channelsConnected: false,
    imageHosts: [],
  }

  it('saves a valid body', async () => {
    const saved = { ...VALID_BODY }
    mockedSaveSettings.mockResolvedValue(saved)
    const res = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        VALID_BODY,
      ),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(mockedSaveSettings).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      {
        logoUrl: 'https://www.ctstours.co.nz/logo.png',
        brandPrimary: '#B61E2E',
        brandSecondary: '#D6A756',
        channelsConnected: false,
        imageHosts: [],
      },
      'admin@example.com',
    )
    expect(await res.json()).toEqual({ settings: saved })
  })

  it('rejects invalid colours, logos and shapes', async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: { ...VALID_BODY, brandPrimary: 'red' }, error: 'invalid_color' },
      {
        body: { ...VALID_BODY, logoUrl: 'http://www.ctstours.co.nz/logo.png' },
        error: 'invalid_logo_url',
      },
      {
        body: { ...VALID_BODY, logoUrl: 'https://evil.example/logo.png' },
        error: 'logo_not_on_client_domain',
      },
      { body: { ...VALID_BODY, channelsConnected: 'yes' }, error: 'invalid_request' },
    ]
    for (const testCase of cases) {
      const res = await settingsPUT(
        jsonRequest(
          'http://localhost/api/clients/client-1/tour-catalog/settings',
          'PUT',
          testCase.body,
        ),
        CONTEXT,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: testCase.error })
    }

    mockedGetClientDomain.mockResolvedValue(null)
    const noDomain = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        VALID_BODY,
      ),
      CONTEXT,
    )
    expect(noDomain.status).toBe(400)
    expect(await noDomain.json()).toEqual({ error: 'logo_not_on_client_domain' })

    expect(mockedSaveSettings).not.toHaveBeenCalled()
  })

  it('saves all-null nullable values with channelsConnected true', async () => {
    const body = {
      logoUrl: null,
      brandPrimary: null,
      brandSecondary: null,
      channelsConnected: true,
      imageHosts: [],
    }
    mockedSaveSettings.mockResolvedValue(body)
    const res = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        body,
      ),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(mockedSaveSettings).toHaveBeenCalledWith({}, CLIENT_ID, body, 'admin@example.com')
  })

  it('rejects invalid JSON and oversized bodies', async () => {
    const bad = await settingsPUT(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        '{nope',
      ),
      CONTEXT,
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_json' })

    const big = await settingsPUT(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        'x'.repeat(64 * 1024 + 1),
      ),
      CONTEXT,
    )
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'request_too_large' })
  })

  it('returns 500 when saving or the domain lookup fails', async () => {
    mockedSaveSettings.mockRejectedValue(new Error('boom'))
    const res = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        VALID_BODY,
      ),
      CONTEXT,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'save_failed' })

    mockedSaveSettings.mockResolvedValue(VALID_BODY)
    mockedGetClientDomain.mockRejectedValue(new Error('boom'))
    const res2 = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        VALID_BODY,
      ),
      CONTEXT,
    )
    expect(res2.status).toBe(500)
    expect(await res2.json()).toEqual({ error: 'save_failed' })
  })

  it('denies access without touching the store', async () => {
    mockedRequireAccess.mockResolvedValue(deniedResponse())
    const res = await settingsPUT(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/settings',
        'PUT',
        VALID_BODY,
      ),
      CONTEXT,
    )
    expect(res.status).toBe(403)
    expect(mockedSaveSettings).not.toHaveBeenCalled()
    expect(mockedGetClientDomain).not.toHaveBeenCalled()
  })
})

describe('publish requests', () => {
  it('saves a trimmed note for a client editor', async () => {
    mockedRequireAccess.mockResolvedValue(editorAccess('staff@cts.example'))
    const request = {
      id: 'r1',
      requestedBy: 'staff@cts.example',
      note: '改了 3 个团的价格',
      createdAt: 't',
      draftVersion: 54,
    }
    mockedUpsertPublishRequest.mockResolvedValue(request)
    const res = await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        { note: '  改了 3 个团的价格  ' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(200)
    expect(mockedUpsertPublishRequest).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      'staff@cts.example',
      54,
      '改了 3 个团的价格',
    )
    expect(await res.json()).toEqual({ request })
  })

  it('defaults a missing note to empty and ignores a requestedBy field', async () => {
    await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        {},
      ),
      CONTEXT,
    )
    expect(mockedUpsertPublishRequest).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      'admin@example.com',
      54,
      '',
    )

    await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        { note: 'x', requestedBy: 'admin@example.com' },
      ),
      CONTEXT,
    )
    expect(mockedUpsertPublishRequest).toHaveBeenLastCalledWith(
      {},
      CLIENT_ID,
      'admin@example.com',
      54,
      'x',
    )
  })

  it('rejects bad notes', async () => {
    const bodies: unknown[] = [
      { note: 'x'.repeat(501) },
      { note: 42 },
      { note: 'a\u202eb' },
      { note: 'a\u200bb' },
    ]
    for (const body of bodies) {
      const res = await publishRequestPOST(
        jsonRequest(
          'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
          'POST',
          body,
        ),
        CONTEXT,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_request' })
    }
    expect(mockedUpsertPublishRequest).not.toHaveBeenCalled()
  })

  it('accepts a 500-character note', async () => {
    const note = 'x'.repeat(500)
    await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        { note },
      ),
      CONTEXT,
    )
    expect(mockedUpsertPublishRequest).toHaveBeenCalledWith(
      {},
      CLIENT_ID,
      'admin@example.com',
      54,
      note,
    )
  })

  it('rejects invalid JSON and oversized bodies', async () => {
    const bad = await publishRequestPOST(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        '{nope',
      ),
      CONTEXT,
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_json' })

    const big = await publishRequestPOST(
      rawRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        'x'.repeat(64 * 1024 + 1),
      ),
      CONTEXT,
    )
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'request_too_large' })
  })

  it('returns 500 when the request cannot be saved', async () => {
    mockedUpsertPublishRequest.mockRejectedValue(new Error('boom'))
    const res = await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        { note: 'x' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'request_failed' })
  })

  it('denies access without touching the store', async () => {
    mockedRequireAccess.mockResolvedValue(deniedResponse())
    const res = await publishRequestPOST(
      jsonRequest(
        'http://localhost/api/clients/client-1/tour-catalog/publish-requests',
        'POST',
        { note: 'x' },
      ),
      CONTEXT,
    )
    expect(res.status).toBe(403)
    expect(mockedGetDraftRevision).not.toHaveBeenCalled()
    expect(mockedUpsertPublishRequest).not.toHaveBeenCalled()
  })
})
