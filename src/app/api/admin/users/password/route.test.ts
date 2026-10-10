import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireGlobalAdmin: vi.fn(),
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
  createUser: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: {
      listUsers: mocks.listUsers,
      updateUserById: mocks.updateUserById,
      createUser: mocks.createUser,
    } },
  },
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.requireGlobalAdmin }))

import { POST } from './route'

function request(body: unknown, origin = 'http://localhost:3001') {
  return new NextRequest('http://localhost:3001/api/admin/users/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin },
    body: JSON.stringify(body),
  })
}

function portalQuery(result: unknown = { data: { id: 'portal-1' }, error: null }) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn(async () => result)
  mocks.from.mockReturnValue(query)
  return query
}

describe('POST /api/admin/users/password', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'http://localhost:3001')
    mocks.from.mockReset()
    mocks.requireGlobalAdmin.mockReset().mockResolvedValue({ ok: true, user: { email: 'admin@example.com' } })
    mocks.listUsers.mockReset().mockResolvedValue({ data: { users: [{ id: 'auth-1', email: 'person@example.com' }] }, error: null })
    mocks.updateUserById.mockReset().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null })
    mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null })
  })

  it('rejects cross-origin requests before checking credentials', async () => {
    const response = await POST(request({ email: 'person@example.com', password: 'strong-password' }, 'https://evil.example'))
    expect(response.status).toBe(403)
    expect(mocks.requireGlobalAdmin).not.toHaveBeenCalled()
  })

  it('requires a global administrator', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await POST(request({ email: 'person@example.com', password: 'strong-password' }))
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects a null JSON body without querying Auth', async () => {
    const response = await POST(request(null))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })

  it('rejects a primitive JSON body without querying Auth', async () => {
    const response = await POST(request('person@example.com'))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })

  it('rejects an array JSON body without querying Auth', async () => {
    const response = await POST(request(['person@example.com', 'strong-password']))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })

  it('rejects short passwords and does not query Auth', async () => {
    const response = await POST(request({ email: 'person@example.com', password: 'short' }))
    expect(response.status).toBe(400)
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })

  it('only resets an email that has a client portal access row', async () => {
    portalQuery({ data: null, error: null })
    const response = await POST(request({ email: 'unknown@example.com', password: 'strong-password' }))
    expect(response.status).toBe(404)
    expect(mocks.listUsers).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('updates an existing Auth account without returning or logging the password', async () => {
    portalQuery()
    const response = await POST(request({ email: ' Person@Example.com ', password: 'strong-password' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, createdAuthUser: false })
    expect(JSON.stringify(body)).not.toContain('strong-password')
    expect(mocks.updateUserById).toHaveBeenCalledWith('auth-1', { password: 'strong-password' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('creates a confirmed Auth account when an invited member does not have one yet', async () => {
    portalQuery()
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null })
    const response = await POST(request({ email: 'person@example.com', password: 'strong-password' }))
    expect(response.status).toBe(200)
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'strong-password',
      email_confirm: true,
    })
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })
})
