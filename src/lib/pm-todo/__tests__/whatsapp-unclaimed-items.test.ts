import { describe, expect, it, vi } from 'vitest'
import { pushWhatsappUnclaimedItems } from '../whatsapp-unclaimed-items'
import { LANE_OF_KIND } from '../five-kinds'
import { NEVER_DROP_KINDS } from '../manual-item-types'
import type { ManualItem } from '../manual-item-types'

/**
 * 表建模的假 supabase：只实现本模块用到的那几个方法。
 * 每个表是一组行；select / is / order / limit / in / update 都作用在行上。
 */

interface UnclaimedRow {
  phone_number_id: string
  last_seen_at: string | null
  last_kind: string | null
  resolved_at: string | null
}

interface ClientRow {
  whatsapp_phone_number_id: string | null
}

interface FakeError {
  code?: string
  message?: string
}

interface FakeState {
  unclaimed: UnclaimedRow[]
  clients: ClientRow[]
  unclaimedReadError: FakeError | null
  clientsReadError: FakeError | null
  unclaimedUpdateError: FakeError | null
}

function makeFakeSupabase(state: FakeState) {
  function from(table: string) {
    if (table === 'whatsapp_unclaimed_numbers') {
      let rows = state.unclaimed.slice()
      let pendingUpdate: Record<string, unknown> | null = null
      const builder = {
        select() {
          return builder
        },
        is(column: string, value: null) {
          if (column === 'resolved_at' && value === null) {
            rows = rows.filter((r) => r.resolved_at === null)
          }
          return builder
        },
        gte(column: string, value: string) {
          // ISO timestamps compare correctly as strings.
          rows = rows.filter((r) => {
            const v = r[column as keyof UnclaimedRow]
            return typeof v === 'string' && v >= value
          })
          return builder
        },
        order(column: string, opts: { ascending: boolean }) {
          rows = rows.slice().sort((a, b) => {
            const av = a[column as keyof UnclaimedRow]
            const bv = b[column as keyof UnclaimedRow]
            const as = av === null ? '' : String(av)
            const bs = bv === null ? '' : String(bv)
            return opts.ascending ? as.localeCompare(bs) : bs.localeCompare(as)
          })
          return builder
        },
        limit(n: number) {
          rows = rows.slice(0, n)
          return builder
        },
        in(column: string, values: string[]) {
          if (pendingUpdate) {
            const set = new Set(values)
            for (const r of state.unclaimed) {
              if (set.has(r.phone_number_id)) {
                r.resolved_at = String(pendingUpdate.resolved_at)
              }
            }
            pendingUpdate = null
            return Promise.resolve({ data: null, error: state.unclaimedUpdateError })
          }
          if (column === 'phone_number_id') {
            const set = new Set(values)
            rows = rows.filter((r) => set.has(r.phone_number_id))
          }
          return builder
        },
        update(patch: Record<string, unknown>) {
          pendingUpdate = patch
          return builder
        },
        then(
          resolve: (value: { data: UnclaimedRow[] | null; error: FakeError | null }) => void,
        ) {
          if (state.unclaimedReadError) {
            resolve({ data: null, error: state.unclaimedReadError })
            return
          }
          resolve({ data: rows, error: null })
        },
      }
      return builder
    }

    if (table === 'clients') {
      let rows = state.clients.slice()
      const builder = {
        select() {
          return builder
        },
        in(column: string, values: string[]) {
          if (column === 'whatsapp_phone_number_id') {
            const set = new Set(values)
            rows = rows.filter(
              (r) =>
                typeof r.whatsapp_phone_number_id === 'string' &&
                set.has(r.whatsapp_phone_number_id),
            )
          }
          return builder
        },
        then(
          resolve: (value: { data: ClientRow[] | null; error: FakeError | null }) => void,
        ) {
          if (state.clientsReadError) {
            resolve({ data: null, error: state.clientsReadError })
            return
          }
          resolve({ data: rows, error: null })
        },
      }
      return builder
    }

    throw new Error(`unexpected table ${table}`)
  }

  return { from }
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    unclaimed: [],
    clients: [],
    unclaimedReadError: null,
    clientsReadError: null,
    unclaimedUpdateError: null,
    ...overrides,
  }
}

const NOW = new Date('2026-10-12T09:00:00.000Z')

function supabaseOf(state: FakeState) {
  return makeFakeSupabase(state) as unknown as Parameters<typeof pushWhatsappUnclaimedItems>[0]
}

describe('pushWhatsappUnclaimedItems', () => {
  it('一个今天见过、没人绑的号码 → 恰好一条待办', async () => {
    const state = baseState({
      unclaimed: [
        {
          phone_number_id: '1234567890',
          last_seen_at: '2026-10-12T08:00:00.000Z',
          last_kind: 'message',
          resolved_at: null,
        },
      ],
    })
    const items: ManualItem[] = []
    await pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW)

    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe('whatsapp_number_unclaimed')
    expect(item.client_id).toBe('infra')
    expect(item.what.length).toBeGreaterThan(0)
    expect(item.how.length).toBeGreaterThan(0)
    expect(item.href.length).toBeGreaterThan(0)
    expect(item.href.startsWith('https://')).toBe(true)
    expect(item.what).toContain('1234567890')
    expect(item.what).not.toContain('RLS')
    expect(item.what).not.toContain('migration')
  })

  it('号码已经被某个客户绑上了 → 不下发，登记行标成已解决', async () => {
    const state = baseState({
      unclaimed: [
        {
          phone_number_id: '1234567890',
          last_seen_at: '2026-10-12T08:00:00.000Z',
          last_kind: 'message',
          resolved_at: null,
        },
      ],
      clients: [{ whatsapp_phone_number_id: '1234567890' }],
    })
    const items: ManualItem[] = []
    await pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW)

    expect(items).toHaveLength(0)
    expect(state.unclaimed[0].resolved_at).toBe(NOW.toISOString())
  })

  it('号码 15 天前见过 → 不下发，登记行不动', async () => {
    const state = baseState({
      unclaimed: [
        {
          phone_number_id: '1234567890',
          last_seen_at: '2026-09-27T08:00:00.000Z',
          last_kind: 'message',
          resolved_at: null,
        },
      ],
    })
    const items: ManualItem[] = []
    await pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW)

    expect(items).toHaveLength(0)
    expect(state.unclaimed[0].resolved_at).toBeNull()
  })

  it('表还没部署（PGRST205 / 42P01）→ 不报错、不下发', async () => {
    for (const code of ['PGRST205', '42P01']) {
      const state = baseState({ unclaimedReadError: { code } })
      const items: ManualItem[] = []
      await expect(
        pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW),
      ).resolves.toBeUndefined()
      expect(items).toHaveLength(0)
    }
  })

  it('其它读取错误 → 抛错', async () => {
    const state = baseState({ unclaimedReadError: { code: 'XX000', message: 'boom' } })
    const items: ManualItem[] = []
    await expect(
      pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW),
    ).rejects.toThrow('whatsapp unclaimed read failed')
  })

  it('客户表读取错误 → 抛错', async () => {
    const state = baseState({
      unclaimed: [
        {
          phone_number_id: '1234567890',
          last_seen_at: '2026-10-12T08:00:00.000Z',
          last_kind: 'message',
          resolved_at: null,
        },
      ],
      clientsReadError: { code: 'XX000', message: 'boom' },
    })
    const items: ManualItem[] = []
    await expect(
      pushWhatsappUnclaimedItems(supabaseOf(state), items, NOW),
    ).rejects.toThrow('whatsapp unclaimed read failed')
  })

  it('车道与铁律登记都对得上', () => {
    expect(LANE_OF_KIND['whatsapp_number_unclaimed']).toBe('one_click')
    expect(NEVER_DROP_KINDS.has('whatsapp_number_unclaimed')).toBe(true)
  })
})
