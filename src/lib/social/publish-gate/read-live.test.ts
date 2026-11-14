import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPublishLive } from './read-live'

function clientDb(config: unknown, error: { message: string } | null = null) {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: error ? null : { publishing_calendar_config: config }, error }),
        }),
      }),
    }),
  }
  return supabase as unknown as SupabaseClient
}

describe('readPublishLive', () => {
  it('is off when the key is missing, and a read error is thrown', async () => {
    expect(await readPublishLive(clientDb(null), '11111111-1111-4111-8111-111111111111', 'image_post')).toBe(false)
    expect(await readPublishLive(clientDb({}), '11111111-1111-4111-8111-111111111111', 'reel_public')).toBe(false)
    await expect(readPublishLive(clientDb(null, { message: 'db down' }), '11111111-1111-4111-8111-111111111111', 'story_register')).rejects.toThrow('db down')
  })

  it('is on only when that kind is boolean true', async () => {
    const config = { publish_live: { story_register: true, image_post: false } }
    const db = clientDb(config)
    expect(await readPublishLive(db, '11111111-1111-4111-8111-111111111111', 'story_register')).toBe(true)
    expect(await readPublishLive(db, '11111111-1111-4111-8111-111111111111', 'image_post')).toBe(false)
  })
})
