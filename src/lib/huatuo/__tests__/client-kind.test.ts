import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { resolveIntakeClientKind } from '../client-kind'
import type { PrescriptionIntake } from '@/types/diagnostic'

const intake: PrescriptionIntake = {
  business_goal: '让更多人认识我',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 500,
  priority_dimensions: [],
  notes: null,
}

function supabaseWith(column: string | null | undefined): { client: SupabaseClient; reads: ReturnType<typeof vi.fn> } {
  const maybeSingle = vi.fn().mockResolvedValue({ data: column === undefined ? null : { client_kind: column }, error: null })
  const reads = vi.fn(() => ({ eq: () => ({ maybeSingle }) }))
  const client = { from: vi.fn(() => ({ select: reads })) } as unknown as SupabaseClient
  return { client, reads }
}

describe('resolveIntakeClientKind', () => {
  it('reads the client kind from the client row when the request does not name one', async () => {
    const { client } = supabaseWith('personal_ip')
    const out = await resolveIntakeClientKind(client, 'c1', { ...intake, weekly_shoot_count: 3 })
    expect(out).toMatchObject({ client_kind: 'personal_ip', weekly_shoot_count: 3 })
  })

  it('treats an empty column as a standard client and drops the shoot count', async () => {
    const { client } = supabaseWith(null)
    const out = await resolveIntakeClientKind(client, 'c1', { ...intake, weekly_shoot_count: 3 })
    expect(out.client_kind).toBe('standard')
    expect(out.weekly_shoot_count).toBeUndefined()
  })

  it('treats an unreadable row (column missing, read failed) as a standard client', async () => {
    const { client } = supabaseWith(undefined)
    expect((await resolveIntakeClientKind(client, 'c1', intake)).client_kind).toBe('standard')
  })

  it('treats a client_kind query error as standard', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'column clients.client_kind does not exist' },
    })
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
    } as unknown as SupabaseClient
    const { loadClientKind } = await import('../client-kind')
    expect(await loadClientKind(client, 'c1')).toBe('standard')
  })

  it('lets the request switch a personal IP client back to standard without reading the row', async () => {
    const { client, reads } = supabaseWith('personal_ip')
    const out = await resolveIntakeClientKind(client, 'c1', { ...intake, client_kind: 'standard' })
    expect(out.client_kind).toBe('standard')
    expect(reads).not.toHaveBeenCalled()
  })

  it('rejects a shoot count that is not a positive whole number', async () => {
    const { client } = supabaseWith('personal_ip')
    const out = await resolveIntakeClientKind(client, 'c1', { ...intake, weekly_shoot_count: -2 })
    expect(out.weekly_shoot_count).toBeNull()
  })
})
