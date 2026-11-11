import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import { targetWeek } from '@/lib/social/week-pack/cadence'

import { lookupWeekPackApproval } from './publish-gate'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-11T18:00:00Z')

function planData(weekStart: string, approval: 'confirmed' | 'declined' | null) {
  return {
    planKind: 'weekly_slot_plan_v1',
    platform: 'facebook',
    weekStart,
    weekEnd: weekStart,
    status: 'ready',
    counts: { story: 1, post: 1, reel: 0 },
    items: [],
    slotDigest: 'abc',
    ...(approval ? { approval: { status: approval, at: '2026-10-10T00:00:00.000Z' } } : {}),
  }
}

function memoryPlans(rows: Array<{ client_id: string; platform: string; plan_data: Record<string, unknown> }>, error = false) {
  return {
    from() {
      const filters: Array<(row: { client_id: string; platform: string; plan_data: Record<string, unknown> }) => boolean> = []
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          filters.push((row) => {
            const arrow = column.indexOf('->>')
            if (arrow === -1) return (row as unknown as Record<string, unknown>)[column] === value
            return row.plan_data[column.slice(arrow + 3)] === value
          })
          return chain
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (error) return { data: null, error: { message: 'down' } }
          const found = rows.filter((row) => filters.every((keep) => keep(row)))
          return { data: found[0] ? { id: 'row-1', plan_data: found[0].plan_data } : null, error: null }
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

function row(weekStart: string, approval: 'confirmed' | 'declined' | null) {
  return { client_id: CLIENT, platform: 'facebook', plan_data: planData(weekStart, approval) }
}

describe('lookupWeekPackApproval', () => {
  const week = targetWeek(NOW).weekStart

  it('reads a confirmed card for this week as approved', async () => {
    const read = await lookupWeekPackApproval(memoryPlans([row(week, 'confirmed')]), CLIENT, NOW)
    expect(read).toBe('approved')
  })

  it('treats a refused card, a missing card, another week, and a failed read as not approved', async () => {
    const refused = await lookupWeekPackApproval(memoryPlans([row(week, 'declined')]), CLIENT, NOW)
    const missing = await lookupWeekPackApproval(memoryPlans([]), CLIENT, NOW)
    const otherWeek = await lookupWeekPackApproval(memoryPlans([row('2026-01-05', 'confirmed')]), CLIENT, NOW)
    const failed = await lookupWeekPackApproval(memoryPlans([], true), CLIENT, NOW)
    expect(refused).toBe('unapproved')
    expect(missing).toBe('missing')
    expect(otherWeek).toBe('missing')
    expect(failed).toBe('unreadable')
    expect(week).not.toBe('2026-01-05')
  })
})
