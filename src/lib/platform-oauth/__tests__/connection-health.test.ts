/**
 * 断线判据的单测。
 *
 * 场景全部取自 2026-09-24 那天生产库里的真实状态（CTS 两个邮箱、Roman HU 和
 * NZCPE 两条 18 天没人管的 Meta 连接、NAL 刚连上还没刷过的 GSC），不是编的。
 */

import { describe, expect, it } from 'vitest'
import {
  assessConnections,
  heartbeatAgeHours,
  missingScopes,
  HEARTBEAT_POLICY,
  SCOPE_REPLAYED_ON_REFRESH,
  type ConnectionHealthRow,
} from '../connection-health'
import { PLATFORM_PROVIDERS, type PlatformProvider } from '../vocabulary'
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'

const NOW = new Date('2026-09-24T03:00:00Z')

function row(over: Partial<ConnectionHealthRow> & { id: string }): ConnectionHealthRow {
  return {
    client_id: 'client-1',
    provider: PLATFORM_PROVIDERS.MICROSOFT_MAIL,
    account_id: 'info@example.com',
    display_name: 'info@example.com',
    status: 'active',
    scopes: [...MICROSOFT_MAIL_SCOPES],
    last_synced_at: '2026-09-24T02:00:00Z',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-24T02:00:00Z',
    ...over,
  }
}

describe('每个平台都必须对心跳和权限表态', () => {
  // 漏一个 provider = 那个平台默默地没有监控，正是这套判据要防的事。
  it.each(Object.values(PLATFORM_PROVIDERS))('%s 声明了心跳策略', (provider) => {
    const policy = HEARTBEAT_POLICY[provider as PlatformProvider]
    expect(policy).toBeDefined()
    expect(policy.why.length).toBeGreaterThan(10)
    if (policy.staleHours !== null) expect(policy.staleHours).toBeGreaterThan(0)
  })

  it.each(Object.values(PLATFORM_PROVIDERS))('%s 声明了刷新时会不会重放权限', (provider) => {
    expect(SCOPE_REPLAYED_ON_REFRESH).toHaveProperty(provider)
  })
})

describe('heartbeatAgeHours', () => {
  it('从没刷新成功过时退回建立时间，不当成健康', () => {
    const age = heartbeatAgeHours(
      row({ id: 'a', last_synced_at: null, created_at: '2026-09-22T03:00:00Z' }),
      NOW,
    )
    expect(age).toBeCloseTo(48, 1)
  })

  it('有心跳时按心跳算', () => {
    expect(heartbeatAgeHours(row({ id: 'a' }), NOW)).toBeCloseTo(1, 1)
  })
})

describe('missingScopes', () => {
  it('列出缺的那几项', () => {
    expect(missingScopes(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c'])
  })
  it('scopes 为 null 时算全缺，不算全有', () => {
    expect(missingScopes(null, ['a'])).toEqual(['a'])
  })
})

describe('assessConnections', () => {
  it('状态不是 active 就报断了，并算出断了多久', () => {
    const findings = assessConnections(
      [row({ id: 'a', status: 'error', updated_at: '2026-09-14T22:11:54Z' })],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('broken')
    if (findings[0].kind === 'broken') {
      expect(findings[0].sinceHours).toBeGreaterThan(24 * 9)
    }
  })

  it('状态是绿的但心跳停了，同平台别人还活着 → 报这一条的授权问题', () => {
    const findings = assessConnections(
      [
        // CTS info@：重连流程把状态改回了 active，心跳却还停在 9 天前
        row({ id: 'cts', last_synced_at: '2026-09-14T21:12:12Z' }),
        // NAL：同一个平台，一小时前刚通过话
        row({ id: 'nal', client_id: 'client-2', last_synced_at: '2026-09-24T02:11:57Z' }),
      ],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('silent')
    if (findings[0].kind === 'silent') {
      expect(findings[0].row.id).toBe('cts')
      expect(findings[0].soleConnection).toBe(false)
    }
  })

  it('🔴 只看状态位会漏掉上面那条 —— 它的 status 就是 active', () => {
    const stale = row({ id: 'cts', last_synced_at: '2026-09-14T21:12:12Z' })
    expect(stale.status).toBe('active')
    const findings = assessConnections([stale, row({ id: 'nal', client_id: 'c2' })], NOW)
    expect(findings.map((f) => f.kind)).toContain('silent')
  })

  it('同平台全部一起停 → 合成一条「取数任务停了」，不给每个客户派重连的活', () => {
    const findings = assessConnections(
      [
        row({ id: 'a', last_synced_at: '2026-09-20T00:00:00Z' }),
        row({ id: 'b', client_id: 'c2', last_synced_at: '2026-09-20T00:00:00Z' }),
      ],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('pipeline_down')
    if (findings[0].kind === 'pipeline_down') expect(findings[0].rows).toHaveLength(2)
  })

  it('整个平台只连了一条时如实标记 soleConnection（分不清就别装分得清）', () => {
    const findings = assessConnections([row({ id: 'a', last_synced_at: '2026-09-20T00:00:00Z' })], NOW)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('silent')
    if (findings[0].kind === 'silent') expect(findings[0].soleConnection).toBe(true)
  })

  it('没有心跳节奏的平台（Meta）不按新鲜度报警，只认状态位', () => {
    const findings = assessConnections(
      [
        // 真实数据：CTS 的 Meta 连接 last_synced_at 停在 9/3，但广告一直在跑
        row({
          id: 'cts-meta',
          provider: PLATFORM_PROVIDERS.META,
          scopes: ['pages_show_list'],
          last_synced_at: '2026-09-03T11:05:57Z',
        }),
      ],
      NOW,
    )
    expect(findings).toEqual([])
  })

  it('Meta 状态位是 error 时照样报（Roman HU / NZCPE 那两条 18 天没人管）', () => {
    const findings = assessConnections(
      [
        row({
          id: 'roman-meta',
          provider: PLATFORM_PROVIDERS.META,
          status: 'error',
          scopes: ['pages_show_list'],
          updated_at: '2026-09-06T17:12:53Z',
        }),
      ],
      NOW,
    )
    expect(findings.map((f) => f.kind)).toEqual(['broken'])
  })

  it('权限比现在要的少 → 还没断就先报（这是 9 天事故的事前信号）', () => {
    const findings = assessConnections(
      [
        // 真实数据：bdm@ctstours.co.nz 当初同意时没有 Mail.ReadWrite
        row({
          id: 'bdm',
          scopes: [
            'offline_access',
            'https://graph.microsoft.com/User.Read',
            'https://graph.microsoft.com/Mail.Read',
            'https://graph.microsoft.com/Mail.Send',
          ],
        }),
      ],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('scope_gap')
    if (findings[0].kind === 'scope_gap') {
      expect(findings[0].missing).toEqual(['https://graph.microsoft.com/Mail.ReadWrite'])
    }
  })

  it('谷歌少了权限不报 —— 它刷新时不重放 scope，不会因此断掉', () => {
    const findings = assessConnections(
      [
        row({
          id: 'gsc',
          provider: PLATFORM_PROVIDERS.GOOGLE_GSC,
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        }),
      ],
      NOW,
    )
    expect(findings).toEqual([])
  })

  it('一条连接最多产出一条发现 —— 断了就不再叠权限那条', () => {
    const findings = assessConnections([row({ id: 'a', status: 'error', scopes: [] })], NOW)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('broken')
  })

  it('刚连上、还没到一个周期的不报（避免新客户第一天就被点名）', () => {
    const findings = assessConnections(
      [row({ id: 'fresh', last_synced_at: null, created_at: '2026-09-23T22:00:00Z' })],
      NOW,
    )
    expect(findings).toEqual([])
  })
})
