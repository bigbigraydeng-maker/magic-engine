import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const operator = vi.fn()
const listAssignees = vi.fn()
const calls: { op: string; args: unknown[] }[] = []
let result: { data?: unknown[]; count?: number; error?: { message: string } | null }

function builder(op: string) {
  const b: Record<string, unknown> = {}
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push({ op: `${op}.${name}`, args })
    return b
  }
  for (const m of ['select', 'update', 'eq', 'ilike']) b[m] = rec(m)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null, ...result }).then(res)
  return b
}
vi.mock('@/lib/auth/client-access', () => ({ requireOperatorAccess: (...a: unknown[]) => operator(...a) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => builder('contacts') } }))
vi.mock('@/lib/crm/lead-assignee', () => ({ listAssignees: (...a: unknown[]) => listAssignees(...a) }))

import { POST } from './route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/clients/c1/crm/assignees/transfer', { method: 'POST', body: JSON.stringify(body) }), {
    params: { id: 'c1' },
  })

describe('POST /crm/assignees/transfer', () => {
  beforeEach(() => {
    calls.length = 0
    listAssignees.mockReset()
    result = { data: [{ id: 'a' }, { id: 'b' }], count: 2 }
    operator.mockResolvedValue({ ok: true, user: { email: 'admin@x.com' } })
    listAssignees.mockResolvedValue([{ email: 'new@x.com' }])
  })

  it('refuses non-operators', async () => {
    operator.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await post({ from: 'old@x.com', to: 'new@x.com' })).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('rejects same person, bad body and a target outside the assignee list', async () => {
    expect((await post({ from: 'a@x.com', to: 'A@x.com' })).status).toBe(400)
    expect((await post({ to: 'new@x.com' })).status).toBe(400)
    expect((await post({ from: 'old@x.com', to: 'stranger@x.com' })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('dry run counts without writing', async () => {
    result = { count: 7 }
    const body = await (await post({ from: 'Old@x.com', to: 'new@x.com', dryRun: true })).json()
    expect(body).toMatchObject({ count: 7, dryRun: true, from: 'old@x.com' })
    expect(calls.some((c) => c.op === 'contacts.update')).toBe(false)
  })

  it('moves everything owned by from, scoped to the client, and escapes wildcards', async () => {
    const body = await (await post({ from: 'old_a@x.com', to: 'new@x.com' })).json()
    expect(body).toMatchObject({ count: 2, dryRun: false, to: 'new@x.com' })
    expect(calls.find((c) => c.op === 'contacts.update')?.args[0]).toEqual({ assigned_to: 'new@x.com' })
    expect(calls).toContainEqual({ op: 'contacts.eq', args: ['client_id', 'c1'] })
    expect(calls).toContainEqual({ op: 'contacts.ilike', args: ['assigned_to', 'old\\_a@x.com'] })
  })

  it('allows handing over to nobody (to = null) without checking the list', async () => {
    const body = await (await post({ from: 'old@x.com', to: null })).json()
    expect(body.to).toBeNull()
    expect(listAssignees).not.toHaveBeenCalled()
  })
})
