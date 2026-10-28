import { describe, expect, it, vi } from 'vitest'
import { listConsoleClients } from './load'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('project desk client list scope', () => {
  it('queries only assigned client IDs for a scoped admin', async () => {
    const inIds = vi.fn().mockResolvedValue({ data: [{ id: 'client-b', name: 'B' }], error: null })
    const db = {
      from: vi.fn(() => ({ select: () => ({ order: () => ({ in: inIds }) }) })),
    } as unknown as SupabaseClient
    const listed = await listConsoleClients(db, ['client-a', 'client-b'])
    expect(inIds).toHaveBeenCalledWith('id', ['client-a', 'client-b'])
    expect(listed).toEqual({ ok: true, clients: [{ id: 'client-b', name: 'B' }] })
  })

  it('does not query all clients when the assigned set is empty', async () => {
    const db = { from: vi.fn() } as unknown as SupabaseClient
    expect(await listConsoleClients(db, [])).toEqual({ ok: true, clients: [] })
    expect(db.from).not.toHaveBeenCalled()
  })
})
