import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { READBACK_TODO_KIND, buildReadbackItem, pushReadbackItems } from '../readback-suggestion-items'

const ok = (over: Record<string, unknown> = {}) => ({
  client_id: 'c1', as_of: '2026-11-16', error: null, counts: { measured: 8, pending: 1, not_readable: 0, unmatched: 0 },
  suggestion: { status: 'ok', lines: ['模板「hot」平均互动 20（3 条），是整体平均 10 的 2 倍：建议多做。'] }, ...over,
})

describe('buildReadbackItem', () => {
  it('advice → one item with the advice text, the "not inquiries" warning and a link', () => {
    const item = buildReadbackItem(ok(), () => 'CTS')
    expect(item).toMatchObject({ kind: READBACK_TODO_KIND, client_id: 'c1', client_name: 'CTS' })
    expect(item?.what).toContain('建议多做')
    expect(item?.what).toContain('不是询价')
    expect(item?.href).toContain('/dashboard/clients/c1')
  })
  it('not enough data and nothing unreadable → no to-do (silence is right, there is nothing to decide)', () => {
    expect(buildReadbackItem(ok({ suggestion: { status: 'not_enough_data', lines: ['样本太少'] } }), () => 'CTS')).toBeNull()
  })
  it('reels past 72h with no numbers raise a to-do that says "not 0"', () => {
    const item = buildReadbackItem(ok({ suggestion: { status: 'not_enough_data', lines: [] }, counts: { measured: 0, pending: 0, not_readable: 2, unmatched: 0 } }), () => 'CTS')
    expect(item?.what).toContain('2 条满 72 小时但没读到数')
    expect(item?.what).toContain('不是 0')
  })
  it('a failed run is its own to-do, never silence', () => {
    const item = buildReadbackItem(ok({ error: 'db down' }), () => 'CTS')
    expect(item?.what).toContain('没跑成')
    expect(item?.what).toContain('db down')
  })
})

describe('pushReadbackItems', () => {
  const db = (rows: unknown[], error: unknown = null): SupabaseClient => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'order']) q[m] = () => q
    q.limit = () => Promise.resolve({ data: rows, error })
    return { from: () => q } as unknown as SupabaseClient
  }
  it('newest receipt per client wins; a failed client list raises an infra item', async () => {
    const items: ManualItem[] = []
    await pushReadbackItems(db([
      { summary: { status: 'done', trigger: 'cron', clients: [ok()] } },
      { summary: { status: 'done', trigger: 'cron', clients: [ok({ suggestion: { status: 'ok', lines: ['旧的'] } })] } },
    ]), items, () => 'CTS', new Date('2026-11-17T00:00:00Z'))
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('建议多做')
    const infra: ManualItem[] = []
    await pushReadbackItems(db([{ summary: { status: 'list_failed', trigger: 'cron', clients: [] } }]), infra, () => 'x', new Date())
    expect(infra[0]).toMatchObject({ client_id: 'infra' })
  })
  it('a read error throws (the caller turns it into a warning, not a silent empty)', async () => {
    await expect(pushReadbackItems(db([], { message: 'boom' }), [], () => 'x', new Date())).rejects.toThrow('boom')
  })
})
