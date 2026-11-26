import { describe, expect, it, vi } from 'vitest'
import { persistReviewExperience } from '../review-experience'

const hoisted = vi.hoisted(() => ({
  preferences: [] as unknown[],
  insertError: null as { message: string } | null,
}))

vi.mock('@/lib/memory/service', () => ({
  savePreference: vi.fn(async (_sb, input) => ({
    id: 'pref-1',
    ...input,
    is_active: true,
    created_at: '2026-11-12',
    updated_at: '2026-11-12',
  })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const passthrough = () => chain
      for (const name of ['select', 'eq', 'limit']) chain[name] = passthrough
      chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (table === 'client_learned_preferences') {
          return Promise.resolve({ data: hoisted.preferences, error: hoisted.insertError }).then(resolve)
        }
        return Promise.resolve({ data: [], error: null }).then(resolve)
      }
      return chain
    },
  },
}))

const supabase = { from: (table: string) => {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const name of ['select', 'eq', 'limit']) chain[name] = passthrough
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
    if (table === 'client_learned_preferences') {
      return Promise.resolve({ data: hoisted.preferences, error: hoisted.insertError }).then(resolve)
    }
    return Promise.resolve({ data: [], error: null }).then(resolve)
  }
  return chain
} }

describe('persistReviewExperience', () => {
  it('skips when preference already exists', async () => {
    hoisted.preferences = [{ id: 'old' }]
    const result = await persistReviewExperience(supabase as never, {
      clientId: 'client-1',
      actionId: 'action-1',
      kindLabel: '调日预算',
      reviewCase: { verdict: 'useful', reason: null, text: '结论：有用。' },
    })
    expect(result).toBe('skipped')
  })
})
