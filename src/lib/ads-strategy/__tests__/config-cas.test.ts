/**
 * writeConfigCas —— 乐观锁写入的 updated_at 语义。
 *
 * 盯的是：
 *   - 调用方在 fields 里传的 updated_at 一律忽略，写入时取当前时间
 *   - 时钟回拨（version.updatedAt 比当前时钟还晚）时，写入的 updated_at 严格大于 version.updatedAt
 *   - 没有行时走 insert，写入含 client_id 与 updated_at
 *   - update 返回空数组 → conflict
 *
 * 假 supabase 只认 ad_strategy_configs，记录 update / insert 的入参。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/email/sender', () => ({ ME_MAIL_TO_ADDRESS: 'team@example.com' }))

import { writeConfigCas, type ConfigVersion } from '../config'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'client-uuid-config-cas-test'
const NOW_ISO = '2026-10-21T00:00:00.000Z'

type Row = Record<string, unknown>

interface FakeTable {
  updateCalls: Row[]
  insertCalls: Row[]
  /** update 的 select 返回什么（默认一行命中）。 */
  setUpdateResult: (rows: Array<{ client_id: string }>) => void
}

function fakeTable(): FakeTable {
  const updateCalls: Row[] = []
  const insertCalls: Row[] = []
  let updateResult: Array<{ client_id: string }> = [{ client_id: CLIENT }]

  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
    return {
      update: (row: Row) => {
        updateCalls.push(row)
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: async () => ({ data: updateResult, error: null }),
        }
        return chain
      },
      insert: async (row: Row) => {
        insertCalls.push(row)
        return { error: null }
      },
    }
  }) as never)

  return {
    updateCalls,
    insertCalls,
    setUpdateResult: rows => { updateResult = rows },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW_ISO))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('writeConfigCas — updated_at 在写入那一刻取', () => {
  it('调用方在 fields 里传了 updated_at → 实际写入的是当前时间，不是传入值', async () => {
    const table = fakeTable()
    const version: ConfigVersion = { exists: true, updatedAt: '2026-10-20T00:00:00.000Z' }

    const res = await writeConfigCas(CLIENT, { updated_at: '2000-01-01T00:00:00.000Z', enabled: false }, version)

    expect(res).toEqual({ ok: true })
    expect(table.updateCalls).toHaveLength(1)
    expect(table.updateCalls[0].updated_at).toBe(NOW_ISO)
    expect(table.updateCalls[0].enabled).toBe(false)
  })

  it('version.updatedAt 比当前时钟还晚 5 秒（时钟回拨）→ 写入的 updated_at = version.updatedAt + 1ms', async () => {
    const table = fakeTable()
    const future = '2026-10-21T00:00:05.000Z'
    const version: ConfigVersion = { exists: true, updatedAt: future }

    const res = await writeConfigCas(CLIENT, { enabled: false }, version)

    expect(res).toEqual({ ok: true })
    expect(table.updateCalls).toHaveLength(1)
    const written = table.updateCalls[0].updated_at as string
    expect(Date.parse(written)).toBe(Date.parse(future) + 1)
    expect(Date.parse(written)).toBeGreaterThan(Date.parse(future))
  })

  it('version.exists === false → 走 insert，写入含 client_id 与 updated_at', async () => {
    const table = fakeTable()
    const version: ConfigVersion = { exists: false, updatedAt: null }

    const res = await writeConfigCas(CLIENT, { enabled: false }, version)

    expect(res).toEqual({ ok: true })
    expect(table.insertCalls).toHaveLength(1)
    expect(table.insertCalls[0].client_id).toBe(CLIENT)
    expect(table.insertCalls[0].updated_at).toBe(NOW_ISO)
    expect(table.insertCalls[0].enabled).toBe(false)
  })

  it('update 返回空数组 → conflict', async () => {
    const table = fakeTable()
    table.setUpdateResult([])
    const version: ConfigVersion = { exists: true, updatedAt: '2026-10-20T00:00:00.000Z' }

    const res = await writeConfigCas(CLIENT, { enabled: false }, version)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe('conflict')
  })
})
