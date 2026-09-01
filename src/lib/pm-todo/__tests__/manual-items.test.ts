/**
 * Unit tests for the pure helpers of the manual handoff lane, plus the
 * to-do email's rendering of it (PM 拍板 2026-08-01: 管道不许断头).
 */

import { describe, it, expect } from 'vitest'
import {
  gscInspectUrl,
  daysAgo,
  loadManualItems,
  pushPlatformCandidateReviewItems,
  pushDataForSeoCreditsItem,
  pushDiscoveryFunnelCloudflareItem,
  type ManualItem,
} from '../manual-items'
import { buildTodoEmail, type TodoCounts } from '../daily-todo'

describe('gscInspectUrl', () => {
  it('builds a deep link that opens the exact URL in Search Console', () => {
    const url = gscInspectUrl('sc-domain:oztopbuildingsupplies.com.au', 'https://oztopbuildingsupplies.com.au/spc')
    expect(url).toContain('search.google.com/search-console/inspect')
    // sc-domain: properties must stay encoded or the console 404s
    expect(url).toContain('resource_id=sc-domain%3Aoztopbuildingsupplies.com.au')
    expect(url).toContain('id=https%3A%2F%2Foztopbuildingsupplies.com.au%2Fspc')
  })
})

describe('daysAgo', () => {
  const now = new Date('2026-08-01T12:00:00Z')
  it('counts whole days, tolerates null and junk', () => {
    expect(daysAgo('2026-07-25T12:00:00Z', now)).toBe(7)
    expect(daysAgo(null, now)).toBeNull()
    expect(daysAgo('not-a-date', now)).toBeNull()
  })
})

describe('pushDataForSeoCreditsItem', () => {
  function fakeDiscoveryQuery(rows: unknown[]) {
    let containsFilter: unknown
    const chain = {
      select: () => chain,
      gte: () => chain,
      contains: (_column: string, value: unknown) => {
        containsFilter = value
        return chain
      },
      limit: async () => ({ data: rows, error: null }),
    }
    return {
      supabase: { from: () => chain } as never,
      getContainsFilter: () => containsFilter,
    }
  }

  it('creates one actionable item only for a persisted 40210 warning', async () => {
    const items: ManualItem[] = []
    const query = fakeDiscoveryQuery([{ id: 'discovery-1' }])
    await pushDataForSeoCreditsItem(query.supabase, items, new Date('2026-09-01T00:00:00Z'))

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'dataforseo_credits_out', client_id: 'infra' })
    expect(items[0].how).toContain('Billing')
    expect(query.getContainsFilter()).toEqual({ meta: { warnings: [{ error_code: 40210 }] } })
  })

  it('does not create a recharge task when the exact 40210 query has no match', async () => {
    const items: ManualItem[] = []
    const query = fakeDiscoveryQuery([])
    await pushDataForSeoCreditsItem(query.supabase, items, new Date('2026-09-01T00:00:00Z'))

    expect(items).toEqual([])
  })
})

describe('pushDiscoveryFunnelCloudflareItem', () => {
  function fakeLeadsQuery(rows: unknown[]) {
    const chain = {
      select: () => chain,
      limit: async () => ({ data: rows, error: null }),
    }
    return { from: () => chain } as never
  }

  it('flags the Cloudflare env gap while discovery_leads is still empty', async () => {
    const items: ManualItem[] = []
    await pushDiscoveryFunnelCloudflareItem(fakeLeadsQuery([]), items)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'discovery_funnel_cloudflare_env_missing', client_id: 'infra' })
    expect(items[0].what).toContain('SUPABASE_URL')
    expect(items[0].how).toContain('Cloudflare')
  })

  it('self-clears once a real lead has landed in discovery_leads', async () => {
    const items: ManualItem[] = []
    await pushDiscoveryFunnelCloudflareItem(fakeLeadsQuery([{ id: 'lead-1' }]), items)

    expect(items).toEqual([])
  })
})

describe('buildTodoEmail — manual lane', () => {
  const EMPTY: TodoCounts = {
    draftsByClient: [],
    findingsByClient: [],
    recentCardsByClient: [],
    reelsByClient: [],
    manualItems: [],
    setupTasks: [],
    cronFailures24h: 0,
  }

  const item: ManualItem = {
    kind: 'not_indexed',
    client_id: 'cid-2',
    client_name: 'oztop',
    what: 'https://oztop/x 谷歌爬过但没收录（已 9 天），这个页面拿不到任何谷歌流量',
    how: '打开链接（已定位到这个网址），点页面上的「请求编入索引」，然后就不用管了',
    href: 'https://search.google.com/search-console/inspect?resource_id=x&id=y',
  }

  it('renders what / how / link for each manual item', () => {
    const { html } = buildTodoEmail(3, { ...EMPTY, manualItems: [item] }, '1 Aug')
    expect(html).toContain('需要你动手')
    expect(html).toContain('谷歌爬过但没收录')
    expect(html).toContain('请求编入索引')
    /**
     * `&` 在 HTML 属性里写成 `&amp;` 才是**正确**的（浏览器会还原成 `&`，链接照常能点）。
     * 从 PR #1037 起 `href` 走统一转义 —— 那一刀是为了挡住客人在私信里发的标记
     * 注进我们自己的日报，见 `daily-todo.ts` 的 `esc()`。
     */
    expect(html).toContain('https://search.google.com/search-console/inspect?resource_id=x&amp;id=y')
    expect(html).toContain('去做这件事')
  })

  it('manual items count toward the subject total', () => {
    const email = buildTodoEmail(3, { ...EMPTY, manualItems: [item, { ...item, kind: 'blog_pr_open' }] }, '1 Aug')
    expect(email.totalItems).toBe(2)
    expect(email.subject).toContain('2 件')
  })

  it('the manual lane renders above the routine sections', () => {
    const { html } = buildTodoEmail(3, {
      ...EMPTY,
      manualItems: [item],
      draftsByClient: [{ name: 'CTS Tours NZ', id: 'cid-1', drafts: 2 }],
    }, '1 Aug')
    expect(html.indexOf('需要你动手')).toBeLessThan(html.indexOf('Blog 草稿待审'))
  })

  it('no manual items → section absent, quiet day still says all-clear', () => {
    const email = buildTodoEmail(3, EMPTY, '1 Aug')
    expect(email.html).not.toContain('需要你动手')
    expect(email.html).toContain('今天没有待办')
  })
})

describe('pushPlatformCandidateReviewItems — 平台候选复查不靠日历记忆', () => {
  const now = new Date('2026-09-27T00:00:00Z')

  it('复查日已到 → 下发待办，不用等人记起来', () => {
    const items: ManualItem[] = []
    pushPlatformCandidateReviewItems(items, now, [
      { name: '跨客户舆情监控引擎', reviewDate: '2026-09-27' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('platform_candidate_review_due')
    expect(items[0].what).toContain('跨客户舆情监控引擎')
    expect(items[0].href).toContain('platform-candidates.md')
  })

  it('复查日还没到 → 不下发', () => {
    const items: ManualItem[] = []
    pushPlatformCandidateReviewItems(items, now, [
      { name: '还没到期的候选', reviewDate: '2026-10-27' },
    ])
    expect(items).toHaveLength(0)
  })

  it('日期格式坏了 → 跳过而不是抛错（不阻塞其他待办）', () => {
    const items: ManualItem[] = []
    expect(() =>
      pushPlatformCandidateReviewItems(items, now, [{ name: '坏日期', reviewDate: 'not-a-date' }]),
    ).not.toThrow()
    expect(items).toHaveLength(0)
  })
})

describe('daysAgo → 文案年龄', () => {
  it('day 0 不该渲染成「已 0 天」（首日实测的文案瑕疵）', () => {
    const now = new Date('2026-08-01T13:00:00Z')
    expect(daysAgo('2026-08-01T04:00:00Z', now)).toBe(0)
    // 渲染层规则：仅当 > 0 才拼年龄，0 天保持安静
    const age = (d: number | null) => (d !== null && d > 0 ? `（已 ${d} 天）` : '')
    expect(age(0)).toBe('')
    expect(age(9)).toBe('（已 9 天）')
  })
})
