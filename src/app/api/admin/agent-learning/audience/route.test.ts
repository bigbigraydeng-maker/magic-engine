import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const h = vi.hoisted(() => ({
  guard: null as Response | null,
  lessons: new Map<string, { evidence: unknown }>(),
  clients: new Set<string>(),
  updates: [] as Array<{ lessonKey: string; patch: Record<string, unknown> }>,
}))

vi.mock('@/lib/auth/require-admin', () => ({
  guardGlobalAdmin: async () => h.guard,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Record<string, string> = {}
      const read = {
        select() { return read },
        eq(column: string, value: string) {
          filters[column] = value
          return read
        },
        maybeSingle: async () => {
          if (table === 'clients') {
            const id = filters.id
            return { data: h.clients.has(id) ? { id } : null, error: null }
          }
          const row = h.lessons.get(filters.lesson_key)
          return { data: row ?? null, error: null }
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_column: string, lessonKey: string) => {
              h.updates.push({ lessonKey, patch })
              return { error: null }
            },
          }
        },
      }
      return read
    },
  },
}))

import { POST } from './route'
import { PATCH } from '@/app/api/ad-engine/lessons/[key]/route'

const post = (body: unknown) => new Request('http://localhost/api', {
  method: 'POST',
  body: JSON.stringify(body),
}) as never

const patch = (body: unknown) => new Request('http://localhost/api', {
  method: 'PATCH',
  body: JSON.stringify(body),
}) as never

beforeEach(() => {
  h.guard = null
  h.updates = []
  h.clients = new Set([CLIENT_A])
  h.lessons = new Map([[
    'expert-sample-1',
    { evidence: { kind: 'expert_rss_candidate', ai_verdict: { suggestion: 'adopt' }, quote: 'keep' } },
  ]])
})

describe('POST /api/admin/agent-learning/audience', () => {
  it('rejects non-admins before writing', async () => {
    h.guard = NextResponse.json({ error: 'no' }, { status: 403 })
    const res = await POST(post({ lessonKey: 'expert-sample-1', mode: 'one', clientId: CLIENT_A }))
    expect(res.status).toBe(403)
    expect(h.updates).toEqual([])
  })

  it('enables one client and keeps the verdict', async () => {
    const res = await POST(post({ lessonKey: 'expert-sample-1', mode: 'one', clientId: CLIENT_A }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.lesson).toEqual({ is_active: true, audience: 'one' })
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]?.patch.is_active).toBe(true)
    expect(h.updates[0]?.patch.evidence).toMatchObject({
      kind: 'expert_rss_candidate',
      ai_verdict: { suggestion: 'adopt' },
      quote: 'keep',
      pilot_client_ids: [CLIENT_A],
    })
  })

  it('does not write when the client is unknown', async () => {
    const res = await POST(post({ lessonKey: 'expert-sample-1', mode: 'one', clientId: CLIENT_B }))
    expect(res.status).toBe(404)
    expect(h.updates).toEqual([])
  })
})

describe('PATCH /api/ad-engine/lessons/[key]', () => {
  it('opening for everyone clears a client list', async () => {
    h.lessons.set('expert-sample-1', {
      evidence: { quote: 'keep', pilot_client_ids: [CLIENT_A] },
    })
    const res = await PATCH(patch({ is_active: true }), { params: Promise.resolve({ key: 'expert-sample-1' }) })
    expect(res.status).toBe(200)
    const evidence = h.updates[0]?.patch.evidence as Record<string, unknown>
    expect(h.updates[0]?.patch.is_active).toBe(true)
    expect(evidence.quote).toBe('keep')
    expect('pilot_client_ids' in evidence).toBe(false)
  })

  it('turning off clears a client list', async () => {
    h.lessons.set('expert-sample-1', {
      evidence: { quote: 'keep', pilot_client_ids: [CLIENT_A] },
    })
    const res = await PATCH(patch({ is_active: false }), { params: Promise.resolve({ key: 'expert-sample-1' }) })
    expect(res.status).toBe(200)
    expect(h.updates[0]?.patch.is_active).toBe(false)
    expect('pilot_client_ids' in (h.updates[0]?.patch.evidence as object)).toBe(false)
  })
})
