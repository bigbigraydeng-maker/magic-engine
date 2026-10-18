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
    token_expiry: '2026-09-24T04:00:00Z',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-24T02:00:00Z',
    ...over,
  }
}

const meta = (over: Partial<ConnectionHealthRow> & { id: string }) =>
  row({ provider: PLATFORM_PROVIDERS.META, scopes: ['pages_show_list'], ...over })

describe('每个平台都必须逐个表态，不许漏', () => {
  // 漏一个 provider = 那个平台默默地没有监控，正是这套判据要防的事。
  it.each(Object.values(PLATFORM_PROVIDERS))('%s 的心跳策略三项都填了', (provider) => {
    const policy = HEARTBEAT_POLICY[provider as PlatformProvider]
    expect(policy).toBeDefined()
    // `why` 是给下一个改判据的人看的，必须说清楚「为什么是这个数 / 为什么没有」
    expect(policy.why.length).toBeGreaterThan(10)
    expect(['per_connection', 'one_per_client']).toContain(policy.refreshScope)
    expect(typeof policy.refreshable).toBe('boolean')
    if (policy.staleHours !== null) expect(policy.staleHours).toBeGreaterThan(0)
  })

  it('声明「能自动续期」的平台，必须跟 token-manager 里真有刷新实现的那几个一致', () => {
    // token-manager.ts::callProviderRefresh 只实现了谷歌系和微软；Meta/TikTok 抛
    // "not yet implemented"。这两处对不上，判据就会对着长期令牌误报或漏报。
    const refreshable = Object.values(PLATFORM_PROVIDERS).filter(
      (p) => HEARTBEAT_POLICY[p as PlatformProvider].refreshable,
    )
    expect(refreshable.sort()).toEqual(
      ['google_ads', 'google_ga4', 'google_gbp', 'google_gsc', 'google_gtm', 'google_youtube', 'microsoft_mail'].sort(),
    )
  })

  it('只有微软那类「刷新会重放权限清单」的平台才做权限缺口判据', () => {
    const replayed = Object.values(PLATFORM_PROVIDERS).filter(
      (p) => SCOPE_REPLAYED_ON_REFRESH[p as PlatformProvider] !== null,
    )
    expect(replayed).toEqual(['microsoft_mail'])
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

describe('assessConnections · 状态位', () => {
  it('status=error 报断了，并算出断了多久', () => {
    const findings = assessConnections(
      [row({ id: 'a', status: 'error', updated_at: '2026-09-14T22:11:54Z' })],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('broken')
    if (findings[0].kind === 'broken') expect(findings[0].sinceHours!).toBeGreaterThan(24 * 9)
  })

  it('🔴 revoked（人主动点的断开）不报 —— 报了就是每天叫 PM 撤销他自己的决定', () => {
    expect(
      assessConnections([row({ id: 'a', status: 'revoked', updated_at: '2026-08-01T00:00:00Z' })], NOW),
    ).toEqual([])
  })

  it('时间戳坏掉时如实说算不出来，绝不当成 0 小时', () => {
    const findings = assessConnections([row({ id: 'a', status: 'error', updated_at: '不是时间' })], NOW)
    expect(findings).toHaveLength(1)
    if (findings[0].kind === 'broken') expect(findings[0].sinceHours).toBeNull()
  })
})

describe('assessConnections · 心跳', () => {
  it('状态绿但心跳停了，同平台别人还活着 → 报这一条的授权问题', () => {
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
      expect(findings[0].cohortFresh).toBe(true)
    }
  })

  it('🔴 只看状态位会漏掉上面那条 —— 它的 status 就是 active', () => {
    const stale = row({ id: 'cts', last_synced_at: '2026-09-14T21:12:12Z' })
    expect(stale.status).toBe('active')
    const findings = assessConnections([stale, row({ id: 'nal', client_id: 'c2' })], NOW)
    expect(findings.map((f) => f.kind)).toContain('silent')
  })

  it('🔴 同一个客户的两个邮箱一起断，算客户级问题，不算「整条通道停了」', () => {
    // CTS 2026-09-15 就是这个形状：一次 scope 改动同时弄死 info@ 和 bdm@。
    // 按连接条数算会判成 pipeline_down → 踢进 dev 栏 → 这件只有邮箱本人
    // 能做的活从 PM 的清单上消失。
    const findings = assessConnections(
      [
        row({ id: 'info', last_synced_at: '2026-09-14T21:00:00Z' }),
        row({ id: 'bdm', account_id: 'bdm@x', last_synced_at: '2026-09-14T20:00:00Z' }),
      ],
      NOW,
    )
    expect(findings.map((f) => f.kind)).toEqual(['silent', 'silent'])
  })

  it('不同客户全部一起停 → 合成一条「取数任务停了」', () => {
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

  it('没有可比的对照时如实标 cohortFresh=false（分不清就别装分得清）', () => {
    const findings = assessConnections([row({ id: 'a', last_synced_at: '2026-09-20T00:00:00Z' })], NOW)
    expect(findings).toHaveLength(1)
    if (findings[0].kind === 'silent') expect(findings[0].cohortFresh).toBe(false)
  })

  it('刚连上、还没到一个周期的不报（避免新客户第一天就被点名）', () => {
    expect(
      assessConnections([row({ id: 'fresh', last_synced_at: null, created_at: '2026-09-23T22:00:00Z' })], NOW),
    ).toEqual([])
  })

  it('🔴 谷歌这类「每客户只刷最新一条」的平台按客户合并 —— 老连接不会永久误报', () => {
    const g = (o: Partial<ConnectionHealthRow> & { id: string }) =>
      row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC, scopes: [], ...o })
    const findings = assessConnections(
      [
        // 客户换了谷歌账号重连 → 多出一行；老的那行永远不会被刷新
        g({ id: 'old', last_synced_at: '2026-08-01T00:00:00Z' }),
        g({ id: 'new', account_id: 'new@x', last_synced_at: '2026-09-23T17:00:00Z' }),
      ],
      NOW,
    )
    expect(findings).toEqual([])
  })

  it('🔴 邮箱这类「逐条遍历」的平台按条判 —— 死掉的那个邮箱不会被活着的盖过去', () => {
    const findings = assessConnections(
      [
        row({ id: 'dead', account_id: 'bdm@x', last_synced_at: '2026-09-14T20:00:00Z' }),
        row({ id: 'alive', account_id: 'info@x', last_synced_at: '2026-09-24T02:00:00Z' }),
      ],
      NOW,
    )
    expect(findings).toHaveLength(1)
    if (findings[0].kind === 'silent') expect(findings[0].row.id).toBe('dead')
  })

  it('不在取数名单里的单独报，且不拖累「整条通道停了」的判据', () => {
    const g = (o: Partial<ConnectionHealthRow> & { id: string }) =>
      row({ provider: PLATFORM_PROVIDERS.GOOGLE_GSC, scopes: [], ...o })
    const findings = assessConnections(
      [
        // NAL 实况：连上两天、client_connectors 还是 partial、没有 site_url
        g({ id: 'nal', client_id: 'nal', last_synced_at: null, created_at: '2026-09-20T00:00:00Z', pipelineEnrolled: false }),
        g({ id: 'cts', client_id: 'cts', last_synced_at: '2026-09-23T17:00:00Z', pipelineEnrolled: true }),
      ],
      NOW,
    )
    expect(findings.map((f) => f.kind)).toEqual(['not_enrolled'])
  })
})

describe('assessConnections · 长期令牌到期', () => {
  it('Meta 令牌过期、状态还是绿的 → 报出来（唯一能提前看见它的判据）', () => {
    const findings = assessConnections(
      [meta({ id: 'm', token_expiry: '2026-09-20T00:00:00Z' })],
      NOW,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('token_expired')
    if (findings[0].kind === 'token_expired') expect(findings[0].expiredHours).toBeCloseTo(99, 0)
  })

  it('🔴 谷歌/微软令牌过期是常态，绝不报 —— 下一次调用会自动换新的', () => {
    // 2026-09-24 实测：7 条谷歌连接全部处于「已过期待刷新」，全都健康。
    const findings = assessConnections(
      [
        row({ id: 'ms', token_expiry: '2026-09-24T02:00:00Z' }),
        row({ id: 'g', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, scopes: [], token_expiry: '2026-09-23T18:00:00Z' }),
      ],
      NOW,
    )
    expect(findings).toEqual([])
  })

  it('Meta 没到期、状态是绿的 → 不报（没有心跳节奏，不按新鲜度判）', () => {
    // 真实数据：CTS 的 Meta 连接 last_synced_at 停在 9/3，但广告一直在跑
    expect(
      assessConnections([meta({ id: 'cts', last_synced_at: '2026-09-03T11:05:57Z', token_expiry: '2026-11-02T11:05:56Z' })], NOW),
    ).toEqual([])
  })

  it('Meta 状态位是 error 时照样报（Roman HU / NZCPE 那两条 18 天没人管）', () => {
    const findings = assessConnections(
      [meta({ id: 'roman', status: 'error', updated_at: '2026-09-06T17:12:53Z', token_expiry: '2026-09-29T07:53:59Z' })],
      NOW,
    )
    expect(findings.map((f) => f.kind)).toEqual(['broken'])
  })
})

describe('assessConnections · 权限缺口', () => {
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
    expect(
      assessConnections(
        [row({ id: 'gsc', provider: PLATFORM_PROVIDERS.GOOGLE_GSC, scopes: ['x'], pipelineEnrolled: true })],
        NOW,
      ),
    ).toEqual([])
  })

  it('一条连接最多产出一条发现 —— 断了就不再叠权限那条', () => {
    const findings = assessConnections([row({ id: 'a', status: 'error', scopes: [] })], NOW)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('broken')
  })
})
