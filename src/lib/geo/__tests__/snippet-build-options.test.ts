import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadGeoSnippetBuildOptions } from '../snippet-build-options'
import type { GeoDirective } from '@/types/magic-engine'

vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: vi.fn(),
}))

vi.mock('@/lib/youtube-publish/store', () => ({
  getClientChannelId: vi.fn(),
}))

import { getActiveBrief } from '@/lib/content/brief-injector'
import { getClientChannelId } from '@/lib/youtube-publish/store'

const DIRECTIVE = {
  id: 'dir-1',
  client_id: 'client-a',
  scenarios: [{ trigger: 'Who coaches founders in Auckland?', response: 'Example', contexts: [] }],
} as unknown as GeoDirective

function supabaseStub(config: {
  clients?: { data: unknown; error: unknown }
  queries?: { data: unknown; error: unknown }
}): SupabaseClient {
  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_visibility_queries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve(config.queries ?? { data: [], error: null })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve(config.clients ?? { data: null, error: null })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.mocked(getActiveBrief).mockReset()
  vi.mocked(getClientChannelId).mockReset()
})

describe('loadGeoSnippetBuildOptions', () => {
  it('returns profile + questions for personal_ip', async () => {
    vi.mocked(getActiveBrief).mockResolvedValue({
      brand_voice: { persona: { name: 'Alex Example', role: 'Coach' } },
    } as never)
    vi.mocked(getClientChannelId).mockResolvedValue('UCabcdefghijklmnopqrstuv')

    const supabase = supabaseStub({
      clients: {
        data: {
          client_kind: 'personal_ip',
          contact_name: 'Backup Name',
          facebook_page_url: 'https://www.facebook.com/example.page',
          tiktok_handle: 'coach.example',
        },
        error: null,
      },
      queries: { data: [{ question: 'Best coach in Auckland?' }], error: null },
    })

    const out = await loadGeoSnippetBuildOptions(supabase, 'client-a', DIRECTIVE)
    expect(out.profile).toMatchObject({
      client_kind: 'personal_ip',
      persona_name: 'Alex Example',
      persona_role: 'Coach',
      facebook_page_url: 'https://www.facebook.com/example.page',
    })
    expect(out.aiTrackingQuestions).toEqual(['Best coach in Auckland?'])
  })

  it('returns empty options for standard clients without loading brief', async () => {
    const supabase = supabaseStub({
      clients: { data: { client_kind: 'standard' }, error: null },
    })
    const out = await loadGeoSnippetBuildOptions(supabase, 'client-a', DIRECTIVE)
    expect(out).toEqual({})
    expect(getActiveBrief).not.toHaveBeenCalled()
  })

  it('falls back to standard when client_kind cannot be read', async () => {
    const supabase = supabaseStub({
      clients: {
        data: null,
        error: { message: 'column clients.client_kind does not exist' },
      },
    })
    const out = await loadGeoSnippetBuildOptions(supabase, 'client-a', DIRECTIVE)
    expect(out).toEqual({})
  })
})
