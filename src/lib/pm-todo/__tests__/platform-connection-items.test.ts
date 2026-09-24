import { describe, expect, it, vi } from 'vitest'
import {
  buildPlatformConnectionItems,
  humanDuration,
  pushPlatformConnectionItems,
  DEV_LANE_CONNECTION_KINDS,
} from '../platform-connection-items'
import { assertAbsoluteHref, type ManualItem } from '../manual-item-types'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'
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
    token_expiry: '2026-09-24T04:00:00Z',
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

  it('🔴 算不出来时如实说，不当成 0 —— 否则「断了 9 天」会显示成「刚断的」', () => {
    expect(humanDuration(null)).toBe('具体多久算不出来')
    expect(humanDuration(Number.NaN)).toBe('具体多久算不出来')
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
    expect(item.what).toContain('询价') // 影响要写出来，不能只说「断了」
    // how 要具体到点哪里：先填地址再点按钮，且点名「用谁的账号」
    expect(item.how).toContain('填进去')
    expect(item.how).toContain('本人')
    expect(item.how).toContain('管理员')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/clients/client-1/settings')
  })

  it('🔴 给 PM 的字里不许有 ** 这种记号（待办邮件按纯文本转义渲染，会原样显示星号）', () => {
    const findings: ConnectionFinding[] = [
      broken,
      { kind: 'token_expired', row: row({ provider: PLATFORM_PROVIDERS.META }), expiredHours: 50 },
      { kind: 'silent', row: row(), staleHours: 12, cohortFresh: true },
      { kind: 'silent', row: row(), staleHours: 12, cohortFresh: false },
      { kind: 'scope_gap', row: row(), missing: ['https://graph.microsoft.com/Mail.ReadWrite'] },
      { kind: 'not_enrolled', row: row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC }) },
      { kind: 'pipeline_down', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, rows: [row()], staleHours: 48 },
    ]
    for (const item of buildPlatformConnectionItems(findings, nameOf)) {
      expect(`${item.what} ${item.how}`).not.toContain('**')
    }
  })

  it('href 要么是绝对网址、要么是空的（相对路径会被链接闸静默丢掉）', () => {
    const findings: ConnectionFinding[] = [
      broken,
      { kind: 'silent', row: row(), staleHours: 12, cohortFresh: false },
      { kind: 'scope_gap', row: row(), missing: ['x'] },
      { kind: 'pipeline_down', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, rows: [row()], staleHours: 48 },
    ]
    for (const item of buildPlatformConnectionItems(findings, nameOf)) {
      expect(() => assertAbsoluteHref(item)).not.toThrow()
    }
  })

  it('🔴 Facebook 的入口在客户页的设置抽屉，不在 /settings（那一页没有这个面板）', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'broken', row: row({ provider: PLATFORM_PROVIDERS.META, account_id: '227633594573276', display_name: 'Roman Hu' }), sinceHours: 400 }],
      nameOf,
    )
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/clients/client-1?settings=platform')
    expect(item.how).toContain('抽屉')
  })

  it('🔴 后台还没有自助重连按钮的平台，整条走 dev 车道 —— 不给 PM 一件点不到按钮的活', () => {
    for (const provider of [PLATFORM_PROVIDERS.TIKTOK, PLATFORM_PROVIDERS.GOOGLE_ADS, PLATFORM_PROVIDERS.GOOGLE_GTM]) {
      const [item] = buildPlatformConnectionItems(
        [{ kind: 'broken', row: row({ provider }), sinceHours: 100 }],
        nameOf,
      )
      expect(item.kind).toBe('platform_connection_no_reconnect_ui')
      expect(item.how).toContain('不用你动手')
      expect(item.href).toBe('')
    }
  })

  it('长期令牌到期：点明「不会自动续期」和「后台显示的还是已连接」', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'token_expired', row: row({ provider: PLATFORM_PROVIDERS.META }), expiredHours: 72 }],
      nameOf,
    )
    expect(item.kind).toBe('platform_connection_token_expired')
    expect(item.what).toContain('不会自动续期')
    expect(item.what).toContain('已连接')
  })

  it('只有一条连接时如实说「也可能是我们这边停了」，不把话说死', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'silent', row: row(), staleHours: 12, cohortFresh: false }],
      nameOf,
    )
    expect(item.what).toContain('也可能是我们这边')
  })

  it('同平台别人还活着时，明说问题出在这一条上', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'silent', row: row(), staleHours: 12, cohortFresh: true }],
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

  it('不在取数名单里 → dev 车道，并明说「重连也没用」', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'not_enrolled', row: row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC }) }],
      nameOf,
    )
    expect(item.kind).toBe('platform_connection_not_enrolled')
    expect(item.client_id).toBe('infra')
    expect(item.how).toContain('重连也没用')
  })

  it('整条通道停了 → 归到后台名下，how 明说不用 PM 动手', () => {
    const [item] = buildPlatformConnectionItems(
      [{ kind: 'pipeline_down', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, rows: [row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC })], staleHours: 48 }],
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
  /** 最小 supabase 替身：只实现这条路真正用到的链式调用，并真的按页返回。 */
  function fakeSupabase(tables: Record<string, unknown[] | Error>) {
    return {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          range: async (from: number, to: number) => {
            const rows = tables[table]
            if (rows instanceof Error) return { data: null, error: { message: rows.message } }
            return { data: (rows ?? []).slice(from, to + 1), error: null }
          },
        }
        return builder
      },
    } as never
  }

  const clients = [{ id: 'client-1', name: 'CTS Tours NZ', client_status: 'active' }]

  it('读得出来时按判据下发', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({ platform_oauth_connections: [row({ status: 'error' })], clients, client_connectors: [] }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_broken'])
  })

  it('🔴 读到零条连接 = 查询被挡了，不是「一切正常」（PostgREST 零行不报错）', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({ platform_oauth_connections: [], clients, client_connectors: [] }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_check_failed'])
    expect(items[0].what).toContain('不报警不等于没断')
  })

  it('🔴 有连接却读不到任何在用的客户 → 同样当故障，不当成「没人要管」', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({ platform_oauth_connections: [row()], clients: [], client_connectors: [] }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_check_failed'])
  })

  it('已归档的客户不再来烦人', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ status: 'error' }), row({ id: 'keep', client_id: 'other', last_synced_at: '2026-09-24T02:00:00Z', scopes: [...MICROSOFT_MAIL_SCOPES] })],
        clients: [
          { id: 'client-1', name: 'CTS Tours NZ', client_status: 'archived' },
          { id: 'other', name: '别家', client_status: 'active' },
        ],
        client_connectors: [],
      }),
      items,
      NOW,
    )
    // 归档客户那条既不报断线，也不该被算成「没主的连接」以外的东西
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_orphan'])
  })

  it('prospect 阶段的客户照常监控 —— 管道活着就会丢客人', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ client_id: 'nal', status: 'error' })],
        clients: [{ id: 'nal', name: 'New Asian Logistics', client_status: 'prospect' }],
        client_connectors: [],
      }),
      items,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('New Asian Logistics')
  })

  it('🔴 谷歌连接没进取数名单 → 报「没接上取数」，不报「去重连」（NAL 实况）', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [
          row({ client_id: 'nal', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, last_synced_at: null, created_at: '2026-09-20T00:00:00Z' }),
        ],
        clients: [{ id: 'nal', name: 'New Asian Logistics', client_status: 'prospect' }],
        // client_connectors 里没有 connected 的行 = 不在名单
        client_connectors: [],
      }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_not_enrolled'])
  })

  it('配置齐全的谷歌连接算进名单，心跳判据照常生效', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [
          row({ client_id: 'client-1', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, last_synced_at: '2026-09-23T17:00:00Z' }),
        ],
        clients,
        client_connectors: [{ client_id: 'client-1', anchor: 'gsc', config: { site_url: 'sc-domain:x.com' } }],
      }),
      items,
      NOW,
    )
    expect(items).toEqual([])
  })

  it('🔴 判据表里没登记的平台要响一声，不能静默降级成「没有监控」', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({
        platform_oauth_connections: [row({ provider: 'brand_new_platform' as never })],
        clients,
        client_connectors: [],
      }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toContain('platform_connection_check_failed')
    expect(items.find((i) => i.kind === 'platform_connection_check_failed')!.what).toContain('brand_new_platform')
  })

  it('🔴 读不出来时自己喊一声 —— 不报 ≠ 没事', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({ platform_oauth_connections: new Error('permission denied'), clients: [] }),
      items,
      NOW,
    )
    expect(items.map((i) => i.kind)).toEqual(['platform_connection_check_failed'])
    expect(items[0].what).toContain('permission denied')
  })

  it('dev 车道那几条的 href 一律为空（免得被链接闸丢掉）', async () => {
    const items: ManualItem[] = []
    await pushPlatformConnectionItems(
      fakeSupabase({ platform_oauth_connections: [], clients, client_connectors: [] }),
      items,
      NOW,
    )
    for (const item of items) {
      if (DEV_LANE_CONNECTION_KINDS.includes(item.kind as never)) expect(item.href).toBe('')
    }
  })
})
