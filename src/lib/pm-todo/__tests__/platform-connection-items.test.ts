import { describe, expect, it, vi } from 'vitest'
import {
  buildPlatformConnectionItems,
  humanDuration,
  pushPlatformConnectionItems,
} from '../platform-connection-items'
import { assertAbsoluteHref, type ManualItem } from '../manual-item-types'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import type { ConnectionFinding, ConnectionHealthRow } from '@/lib/platform-oauth/connection-health'

const NOW = new Date('2026-09-24T03:00:00Z')

function row(over: Partial<ConnectionHealthRow> = {}): ConnectionHealthRow {
  return {
    id: 'conn-1',
    client_id: 'client-1',
    provider: PLATFORM_PROVIDERS.MICROSOFT_MAIL,
    account_id: 'info@ctstours.co.nz',
    display_name: 'info@ctstours.co.nz',
    status: 'active',
    scopes: [],
    last_synced_at: null,
    created_at: '2026-08-03T15:02:07Z',
    updated_at: '2026-09-14T23:12:04Z',
    ...over,
  }
}

const nameOf = (id: string) => (id === 'client-1' ? 'CTS Tours NZ' : undefined)

describe('humanDuration', () => {
  it.each([
    [0.5, '不到 1 小时'],
    [13, '13 小时'],
    [222, '9 天'],
  ])('%s 小时 → %s', (h, expected) => {
    expect(humanDuration(h)).toBe(expected)
  })
})

describe('buildPlatformConnectionItems', () => {
  const broken: ConnectionFinding = { kind: 'broken', row: row(), sinceHours: 222 }

  it('三件套齐全：说清损失、说清怎么做、给直达链接', () => {
    const [item] = buildPlatformConnectionItems([broken], nameOf)
    expect(item.kind).toBe('platform_connection_broken')
    expect(item.client_name).toBe('CTS Tours NZ')
    expect(item.what).toContain('9 天')
    expect(item.what).toContain('info@ctstours.co.nz')
    // 影响要写出来，不能只说「断了」
    expect(item.what).toContain('询价')
    // how 要具体到点哪里，且点名「用谁的账号」—— 这条管道最贵的错误
    expect(item.how).toContain('本人')
    expect(item.how).toContain('管理员')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/clients/client-1/settings')
  })

  it('href 一律绝对网址（相对路径会被链接闸静默丢掉）', () => {
    const findings: ConnectionFinding[] = [
      broken,
      { kind: 'silent', row: row(), staleHours: 12, soleConnection: true },
      { kind: 'scope_gap', row: row(), missing: ['https://graph.microsoft.com/Mail.ReadWrite'] },
      {
        kind: 'pipeline_down',
        provider: PLATFORM_PROVIDERS.GOOGLE_GSC,
        rows: [row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC })],
        staleHours: 48,
      },
    ]
    for (const item of buildPlatformConnectionItems(findings, nameOf)) {
      expect(() => assertAbsoluteHref(item)).not.toThrow()
    }
  })

  it('只有一条连接时如实说「也可能是我们这边停了」，不把话说死', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'silent', row: row(), staleHours: 12, soleConnection: true }],
      nameOf,
    )
    expect(item.what).toContain('也可能是我们这边')
  })

  it('同平台别人还活着时，明说问题出在这一条上', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'silent', row: row(), staleHours: 12, soleConnection: false }],
      nameOf,
    )
    expect(item.what).toContain('别的客户今天都通上了')
  })

  it('权限缺口在断之前就提醒，并说明「现在重连就能避免」', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'scope_gap', row: row(), missing: ['https://graph.microsoft.com/Mail.ReadWrite'] }],
      nameOf,
    )
    expect(item.kind).toBe('platform_connection_scope_gap')
    // 完整 scope 网址对 PM 没意义，只留末段
    expect(item.what).toContain('Mail.ReadWrite')
    expect(item.what).not.toContain('https://graph.microsoft.com/Mail.ReadWrite')
    expect(item.how).toContain('趁现在还没断')
  })

  it('整条通道停了 → 归到后台名下，how 明说不用 PM 动手', () => {
    const [item] = buildPlatformConnectionItems(
      [
        {
          kind: 'pipeline_down',
          provider: PLATFORM_PROVIDERS.GOOGLE_GSC,
          rows: [row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC })],
          staleHours: 48,
        },
      ],
      nameOf,
    )
    expect(item.kind).toBe('platform_connection_pipeline_down')
    expect(item.client_id).toBe('infra')
    expect(item.how).toContain('不用你动手')
  })

  it('客户表里查不到名字时退回连接自己的显示名，不丢这条', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'broken', row: row({ client_id: 'unknown' }), sinceHours: 30 }],
      nameOf,
    )
    expect(item.client_name).toBe('info@ctstours.co.nz')
  })
})

describe('pushPlatformConnectionItems', () => {
  /** 最小 supabase 替身：只实现这条路真正用到的链式调用。 */
  function fakeSupabase(tables: Record<string, unknown[] | Error>) {
    return {
      from(table: string) {
        const builder = {
          select: () => builder,
          order: () => builder,
          range: async () => {
            const rows = tables[table]
            if (rows instanceof Error) return { data: null, error: { message: rows.message } }
            return { data: rows, error: null }
          },
        }
        return builder
      },
    } as never
  }

  it('读得出来时按判据下发', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ status: 'error' })],
        clients: [{ id: 'client-1', name: 'CTS Tours NZ', client_status: 'active' }],
      }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_broken'])
  })

  it('已归档的客户不再来烦人', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ status: 'error' })],
        clients: [{ id: 'client-1', name: 'CTS Tours NZ', client_status: 'archived' }],
      }),
      items,
      NOW,
    )
    expect(items).toEqual([])
  })

  it('prospect 阶段的客户照常监控 —— 管道活着就会丢客人', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ client_id: 'nal', status: 'error' })],
        clients: [{ id: 'nal', name: 'New Asian Logistics', client_status: 'prospect' }],
      }),
      items,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('New Asian Logistics')
  })

  it('🔴 读不出来时自己喊一声 —— 不报 ≠ 没事', async () => {
    const items: ManualItem[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: new Error('permission denied'),
        clients: [],
      }),
      items,
      NOW,
    )
    spy.mockRestore()
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_check_failed'])
    expect(items[0].what).toContain('不报警不等于没断')
  })
})
