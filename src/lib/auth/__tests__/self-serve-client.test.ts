import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { ensureSelfServeClientForEmail } from '../self-serve-client'

function accessRows(rows: Array<{ client_id: string; access_type: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows }),
  }
}

function clientInsert(clientId: string) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: clientId }, error: null }),
  }
}

function portalInsert() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  }
}

function noScan() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  }
}

describe('ensureSelfServeClientForEmail', () => {
  beforeEach(() => {
    mocks.from.mockReset()
  })

  it('returns the existing self-serve client without creating another workspace', async () => {
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-existing', access_type: 'self_serve' },
    ]) as unknown as ReturnType<typeof supabaseAdmin.from>)

    await expect(ensureSelfServeClientForEmail({ email: 'User@Example.com' }))
      .resolves.toEqual({ clientId: 'client-existing', created: false })

    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('does not create a self-serve workspace for an email that already has managed access', async () => {
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-managed', access_type: 'portal' },
    ]) as unknown as ReturnType<typeof supabaseAdmin.from>)

    await expect(ensureSelfServeClientForEmail({ email: 'client@example.com' }))
      .rejects.toThrow('Email already has Magic Engine access')

    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('creates a self-serve client and portal access for a new Google user', async () => {
    const clientChain = clientInsert('client-new')
    const portalChain = portalInsert()

    mocks.from
      .mockReturnValueOnce(accessRows([]) as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(clientChain as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(portalChain as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(noScan() as unknown as ReturnType<typeof supabaseAdmin.from>)

    await expect(ensureSelfServeClientForEmail({
      email: 'new@example.com',
      displayName: 'New Founder',
    })).resolves.toEqual({ clientId: 'client-new', created: true })

    expect(clientChain.insert).toHaveBeenCalledWith({
      name: 'New Founder Workspace',
      domain: null,
      source: 'self_serve',
    })
    expect(portalChain.insert).toHaveBeenCalledWith({
      email: 'new@example.com',
      client_id: 'client-new',
      display_name: 'New Founder',
      access_type: 'self_serve',
    })
  })
})
