import { describe, expect, it } from 'vitest'

import { loadSocialReadbackPanel } from '@/lib/social/social-readback-load'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

interface Call {
  table: string
  filters: Array<[string, string, unknown]>
}

function fakeClient(input: {
  stories: Array<Record<string, unknown>>
  registrations: Array<Record<string, unknown>>
  verdicts?: Array<Record<string, unknown>>
  verdictError?: { code?: string; message: string } | null
}): { client: { from: (table: string) => unknown }; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.push(['eq', key, value])
          return chain
        },
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        in: (key: string, value: unknown) => {
          filters.push(['in', key, value])
          return chain
        },
        then: (resolve: (value: { data: unknown; error: { code?: string; message: string } | null }) => void) => {
          calls.push({ table, filters })
          if (table === 'social_verification_verdicts') {
            resolve({ data: input.verdictError ? null : (input.verdicts ?? []), error: input.verdictError ?? null })
            return
          }
          const actionType = filters.find((f) => f[0] === 'eq' && f[1] === 'action_type')?.[2]
          if (table === 'story_items') {
            resolve({ data: input.stories, error: null })
            return
          }
          if (table === 'flywheel_actions' && actionType === 'social.publish_story') {
            const keys = filters.find((f) => f[0] === 'in' && f[1] === 'payload->>idempotency_key')?.[2]
            const wanted = new Set(Array.isArray(keys) ? keys : [])
            const matched = input.registrations.filter((row) => {
              const payload = row.payload as { idempotency_key?: string } | undefined
              return payload?.idempotency_key !== undefined && wanted.has(payload.idempotency_key)
            })
            resolve({ data: matched, error: null })
            return
          }
          resolve({ data: [], error: null })
        },
      }
      return chain
    },
  }
  return { client, calls }
}

describe('loadSocialReadbackPanel story registration', () => {
  it('matches the newest shown story even when older registrations exceed 200', async () => {
    const older = Array.from({ length: 200 }, (_, index) => ({
      payload: { idempotency_key: `story-lite:old-${index}` },
    }))
    const { client, calls } = fakeClient({
      stories: [
        {
          item_id: 'newest-story',
          channel: 'facebook_story',
          status: 'SENT',
          sent_at: '2026-11-03T08:00:00.000Z',
          slot_at: '2026-11-03T08:00:00.000Z',
        },
      ],
      registrations: [
        ...older,
        { payload: { idempotency_key: 'story-lite:newest-story' } },
      ],
    })

    const panel = await loadSocialReadbackPanel(client as never, {
      clientId: CLIENT,
      since: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-11-04T00:00:00.000Z'),
      now: new Date('2026-11-03T12:00:00.000Z'),
    })

    const story = panel.items.find((item) => item.id === 'newest-story')
    expect(story?.story_registered).toBe(true)
    const registrationCall = calls.find((call) =>
      call.filters.some((filter) => filter[2] === 'social.publish_story'),
    )
    expect(registrationCall?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'client_id', CLIENT],
        ['in', 'payload->>idempotency_key', ['story-lite:newest-story']],
      ]),
    )
  })

  it('attaches the earliest direct-message label and still shows the story if the verdict table is missing', async () => {
    const story = {
      item_id: 'newest-story',
      channel: 'facebook_story',
      status: 'SENT',
      sent_at: '2026-11-03T08:00:00.000Z',
      slot_at: '2026-11-03T08:00:00.000Z',
    }
    const registrations = [{ id: 'action-1', payload: { idempotency_key: 'story-lite:newest-story', item_id: 'newest-story' } }]
    const shown = fakeClient({
      stories: [story],
      registrations,
      verdicts: [
        {
          content_action_id: 'action-1',
          verdict: 'counted',
          observed_value: '2',
          reason: null,
          window_hours: 12,
          created_at: '2026-11-03T20:00:00.000Z',
        },
      ],
    })
    const panel = await loadSocialReadbackPanel(shown.client as never, {
      clientId: CLIENT,
      since: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-11-04T00:00:00.000Z'),
      now: new Date('2026-11-03T12:00:00.000Z'),
    })
    expect(panel.items[0]?.story_dm).toContain('新开私信 2 条')

    const missing = fakeClient({
      stories: [story],
      registrations,
      verdictError: { code: '42P01', message: 'relation social_verification_verdicts does not exist' },
    })
    const fallback = await loadSocialReadbackPanel(missing.client as never, {
      clientId: CLIENT,
      since: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-11-04T00:00:00.000Z'),
      now: new Date('2026-11-03T12:00:00.000Z'),
    })
    expect(fallback.items[0]?.story_registered).toBe(true)
    expect(fallback.items[0]?.story_dm ?? null).toBeNull()
  })
})
