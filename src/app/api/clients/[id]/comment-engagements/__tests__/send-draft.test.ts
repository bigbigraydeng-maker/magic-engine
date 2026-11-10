/**
 * PATCH action 'send_draft' — a person sends the stored draft as the public reply.
 *
 * The Meta call is the real `replyToComment` over a stubbed network, so the
 * test sees the request that would actually leave the building.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizeConfiguredPage: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { PATCH } from '../route'

const CLIENT = 'client-test'
const ROW_ID = 'row-1'

interface Row {
  id: string
  client_id: string
  page_id: string
  comment_id: string
  public_reply_text: string | null
  public_reply_id: string | null
  reply_status: string
  [key: string]: unknown
}

let row: Row | null
const updates: Array<Record<string, unknown>> = []

/** A one-row table: filters are checked against the row, updates are applied to it. */
function table() {
  const filters: Array<[string, unknown]> = []
  let patch: Record<string, unknown> | null = null
  const matches = (): boolean => row !== null && filters.every(([k, v]) => row![k] === v)
  const settle = () => {
    if (!matches()) return { data: null, error: null }
    if (patch) {
      updates.push(patch)
      Object.assign(row!, patch)
    }
    return { data: { ...row! }, error: null }
  }
  const q = {
    select: () => q,
    update: (p: Record<string, unknown>) => { patch = p; return q },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
    is: (k: string, v: unknown) => { filters.push([k, v]); return q },
    maybeSingle: () => Promise.resolve(settle()),
    then: (ok: (v: { data: unknown; error: null }) => unknown) => Promise.resolve(settle()).then(ok),
  }
  return q
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/client-test/comment-engagements', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const send = (body: Record<string, unknown>) =>
  PATCH(patchRequest({ engagement_id: ROW_ID, action: 'send_draft', ...body }), { params: Promise.resolve({ id: CLIENT }) })

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SOCIAL_COMMENT_AUTOREPLY_KILL
  updates.length = 0
  row = {
    id: ROW_ID, client_id: CLIENT, page_id: 'page-1', comment_id: 'comment-1',
    public_reply_text: 'Stored draft.', public_reply_id: null, reply_status: 'pending', reply_source: 'catalog_draft',
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(() => table() as never)
  vi.mocked(requireDashboardClientAccess).mockResolvedValue({
    ok: true, user: { email: 'staff@example.test' }, role: 'admin', tier: 'full', allowedClientId: null,
  } as never)
  vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'staff_verified' })
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'reply-9' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => { vi.unstubAllGlobals() })

function sentBody(): URLSearchParams {
  return new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body))
}

describe('send_draft', () => {
  it('posts the stored draft once and records who sent it', async () => {
    const res = await send({})
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, action: 'send_draft', public_reply_id: 'reply-9' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/comment-1\/comments$/)
    expect(sentBody().get('message')).toBe('Stored draft.')
    expect(sentBody().get('access_token')).toBe('page-token')
    expect(row).toMatchObject({
      reply_status: 'replied', public_reply_id: 'reply-9', public_reply_text: 'Stored draft.',
      needs_human: false, reviewed_by: 'staff@example.test',
    })
  })

  it('posts the edited text, punctuation intact', async () => {
    const edited = 'Hi Sam & co — yes, a guide is included + flights #1?'
    await send({ text: `  ${edited}  ` })
    expect(sentBody().get('message')).toBe(edited)
    expect(row?.public_reply_text).toBe(edited)
  })

  it('takes the sender from the session, not from the request body', async () => {
    await send({ reviewer: 'someone-else@example.test' })
    expect(row?.reviewed_by).toBe('staff@example.test')
  })

  it.each(['replied', 'processing', 'reverted', 'hidden'])('refuses a row that is %s', async (status) => {
    row!.reply_status = status
    const res = await send({})
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a row that already has a public reply', async () => {
    row!.public_reply_id = 'reply-old'
    expect((await send({})).status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when there is nothing to send', async () => {
    row!.public_reply_text = null
    expect((await send({ text: '   ' })).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an over-long reply', async () => {
    expect((await send({ text: 'a'.repeat(1001) })).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send when the Page is not the client\'s verified Page', async () => {
    vi.mocked(authorizeConfiguredPage).mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'x' } as never)
    expect((await send({})).status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row?.reply_status).toBe('pending')
  })

  it('a row of another client is not found', async () => {
    row!.client_id = 'other-client'
    expect((await send({})).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('when Facebook refuses, the row goes back to pending with the draft kept', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"nope"}}', { status: 400 }))
    const res = await send({})
    expect(res.status).toBe(502)
    expect(row).toMatchObject({ reply_status: 'pending', public_reply_text: 'Stored draft.', public_reply_id: null })
    expect(String(row?.error_message)).toContain('send_draft')
  })

  it('a second click after the first one lands does not post again', async () => {
    await send({})
    const again = await send({})
    expect(again.status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  describe('the client\'s own staff', () => {
    beforeEach(() => {
      vi.mocked(requireDashboardClientAccess).mockResolvedValue({
        ok: true, user: { email: 'owner@client.test' }, role: 'client-viewer', tier: 'full', allowedClientId: CLIENT,
      } as never)
    })

    it('may send and edit a drafted reply', async () => {
      const res = await send({ text: 'Edited draft.' })
      expect(res.status).toBe(200)
      expect(sentBody().get('message')).toBe('Edited draft.')
      expect(row?.reviewed_by).toBe('owner@client.test')
    })

    it.each([
      ['a waiting comment with no draft', { reply_source: 'fallback', public_reply_text: null }],
      ['a row whose draft text is blank', { reply_source: 'catalog_draft', public_reply_text: '  ' }],
    ])('may not write a reply from nothing on %s', async (_label, over) => {
      Object.assign(row!, over)
      const res = await send({ text: 'Anything I like.' })
      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(row?.reply_status).toBe('pending')
    })
  })

  it('our staff may reply to a waiting comment that has no draft', async () => {
    Object.assign(row!, { reply_source: 'fallback', public_reply_text: null })
    const res = await send({ text: 'Written by a person.' })
    expect(res.status).toBe(200)
    expect(sentBody().get('message')).toBe('Written by a person.')
  })

  it('the global stop for comment replies stops a person\'s send too', async () => {
    process.env.SOCIAL_COMMENT_AUTOREPLY_KILL = '1'
    const res = await send({})
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row?.reply_status).toBe('pending')
  })

  it('signed-out callers are turned away before anything is read', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)
    expect((await send({})).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
