/**
 * Unit tests for the pure helpers of the manual handoff lane, plus the
 * to-do email's rendering of it (PM 拍板 2026-08-01: 管道不许断头).
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushEmailReplyItems } from '../email-reply-items'
import {
  gscInspectUrl,
  daysAgo,
  loadManualItems,
  pushPlatformCandidateReviewItems,
  pushClientDocManualTaskItems,
  pushDataForSeoCreditsItem,
  pushMailchimpExportItems,
  pushPriceGateItems,
  buildNotIndexedItems,
  assertAbsoluteHref,
  dropBrokenLinks,
  type NotIndexedRow,
  type ManualItem,
} from '../manual-items'
import {
  buildCrawlHealthItems,
  NOT_INDEXED_REPORT_ORDER,
  SITE_FIREWALL_ALLOWLIST_SOP_URL,
  type CrawlHealthRow,
} from '../manual-item-types'
import { INDEX_CLASS_META, isActionableNotIndexed, type IndexClass } from '@/lib/seo/index-status'
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

describe('pushMailchimpExportItems', () => {
  const NOW = new Date('2026-09-03T09:00:00Z')

  function fakeLastRun(row: { finished_at: string; summary: unknown } | null) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: row ? [row] : [], error: null }),
    }
    return { from: () => chain } as unknown as SupabaseClient
  }

  it('非预期失败（配置读不出来 / API key 失效）逐客户下发，正常的「没配 Mailchimp」不下发', async () => {
    const items: ManualItem[] = []
    const supabase = fakeLastRun({
      finished_at: '2026-09-03T08:00:00Z',
      summary: {
        results: [
          {
            clientId: 'c-broken',
            clientName: 'CTS Tours NZ',
            mailchimp: { 'skipped:client_config_read_failed': 3, 'failed:auth': 2 },
          },
          {
            clientId: 'c-not-configured',
            clientName: 'Oztop',
            mailchimp: { 'skipped:no_audience_config': 5, 'skipped:no_email': 1 },
          },
        ],
      },
    })

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'mailchimp_export_broken', client_id: 'c-broken', client_name: 'CTS Tours NZ' })
    expect(items[0].what).toContain('5 条')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c-broken/settings')
  })

  it('最近一次运行早就过期（超过 6 小时）→ 不再报旧问题', async () => {
    const items: ManualItem[] = []
    const supabase = fakeLastRun({
      finished_at: '2026-09-03T00:00:00Z',
      summary: { results: [{ clientId: 'c-broken', clientName: 'CTS', mailchimp: { 'failed:auth': 1 } }] },
    })

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toEqual([])
  })

  it('人在名单里但来源标签没补上 → 也要报（归因证据没落地，跟发失败一样严重）', async () => {
    const items: ManualItem[] = []
    const supabase = fakeLastRun({
      finished_at: NOW.toISOString(),
      summary: {
        results: [
          {
            clientId: 'c-broken',
            clientName: 'CTS Tours NZ',
            mailchimp: { 'already_member:tag_failed:http_429': 4, already_member: 6 },
          },
        ],
      },
    })

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'mailchimp_export_broken', client_id: 'c-broken' })
    // 只数坏的那 4 条，正常的 6 条不许算进去
    expect(items[0].what).toContain('4 条')
  })

  it('标签都打上了的正常 already_member → 一条都不报，别天天骚扰', async () => {
    const items: ManualItem[] = []
    const supabase = fakeLastRun({
      finished_at: NOW.toISOString(),
      summary: {
        results: [{ clientId: 'c-ok', clientName: 'CTS', mailchimp: { already_member: 10 } }],
      },
    })

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toEqual([])
  })

  it('最近一轮是让路，改看更早那轮真实出口故障', async () => {
    const items: ManualItem[] = []
    const rows = [
      { finished_at: '2026-09-03T08:40:00Z', summary: { skipped: 'overlap' } },
      {
        finished_at: '2026-09-03T08:00:00Z',
        summary: { results: [{ clientId: 'c-broken', clientName: 'CTS', mailchimp: { 'failed:auth': 1 } }] },
      },
    ]
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
    }
    const supabase = { from: () => chain } as unknown as SupabaseClient

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'mailchimp_export_broken', client_id: 'c-broken' })
  })

  it('压根没有运行记录 → 不报', async () => {
    const items: ManualItem[] = []
    await pushMailchimpExportItems(fakeLastRun(null), items, NOW)

    expect(items).toEqual([])
  })

  it('只挑跑完的运行记录 —— 卡在 running（finished_at 永远 NULL）的记录不该挡住后续告警', async () => {
    const notCalls: Array<[string, unknown]> = []
    const inCalls: Array<[string, unknown]> = []
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: (col: string, op: string, val: unknown) => {
        notCalls.push([col, val])
        return chain
      },
      in: (col: string, vals: unknown) => {
        inCalls.push([col, vals])
        return chain
      },
      order: () => chain,
      limit: async () => ({
        data: [
          {
            finished_at: '2026-09-03T08:30:00Z',
            summary: { results: [{ clientId: 'c-broken', clientName: 'CTS', mailchimp: { 'failed:auth': 1 } }] },
          },
        ],
        error: null,
      }),
    }
    const supabase = { from: () => chain } as unknown as SupabaseClient

    const items: ManualItem[] = []
    await pushMailchimpExportItems(supabase, items, NOW)

    expect(notCalls).toContainEqual(['finished_at', null])
    expect(inCalls).toContainEqual(['status', ['completed', 'failed']])
    expect(items).toHaveLength(1)
  })

  it('那一轮因为别的客户 Meta 取数报错被 run-logger 标成 failed，本客户真实的 Mailchimp 出口故障依然要下发', async () => {
    const items: ManualItem[] = []
    const supabase = fakeLastRun({
      finished_at: '2026-09-03T08:30:00Z',
      summary: {
        results: [
          { clientId: 'c-meta-broken', clientName: '另一个客户', error: 'Meta token expired' },
          {
            clientId: 'c-broken',
            clientName: 'CTS Tours NZ',
            mailchimp: { 'failed:auth': 2 },
          },
        ],
      },
    })

    await pushMailchimpExportItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'mailchimp_export_broken', client_id: 'c-broken' })
  })

  it('查运行记录本身报错 → 必须抛出，不能当成「没有记录」静默吞掉', async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: null, error: { message: 'permission denied' } }),
    }
    const supabase = { from: () => chain } as unknown as SupabaseClient

    const items: ManualItem[] = []
    await expect(pushMailchimpExportItems(supabase, items, NOW)).rejects.toThrow('permission denied')
  })
})

describe('buildNotIndexedItems — 谷歌没收录的页面按客户汇总，别一页一条', () => {
  const NOW = new Date('2026-09-04T00:00:00Z')
  const nameOf = (id: string) => (id === 'oztop' ? 'oztop' : id === 'cts' ? 'CTS Tours NZ' : id)
  // 有 GSC 连接才有能直达的未收录清单；两个客户都连了。
  const siteUrls = new Map<string, string>([
    ['oztop', 'sc-domain:oztop.com.au'],
    ['cts', 'sc-domain:ctstours.co.nz'],
  ])

  const page = (client_id: string, i: number, over: Partial<NotIndexedRow> = {}): NotIndexedRow => ({
    client_id,
    url: `https://site/${client_id}/p${i}`,
    index_verdict: 'Crawled - currently not indexed',
    first_not_indexed_at: '2026-08-01T00:00:00Z',
    word_count: 800,
    crawl_status: null,
    crawled_at: null,
    ...over,
  })

  const CLEAN = { crawl_status: 'crawled', crawled_at: '2026-09-01T00:00:00Z' } as const

  it('🔴 116 + 6 个未收录页面 → 只出 2 条（每客户一条），不是 122 条', () => {
    const oztop: NotIndexedRow[] = [
      ...Array.from({ length: 55 }, (_, i) => page('oztop', i, { word_count: 120, ...CLEAN })), // 内容太薄
      ...Array.from({ length: 6 }, (_, i) => page('oztop', 100 + i, { index_verdict: 'URL is unknown to Google' })),
      ...Array.from({ length: 55 }, (_, i) => page('oztop', 200 + i)), // 爬过没收录
    ]
    const cts = Array.from({ length: 6 }, (_, i) => page('cts', i))
    const items = buildNotIndexedItems([...oztop, ...cts], siteUrls, nameOf, NOW)

    expect(items).toHaveLength(2)
    const oz = items.find((i) => i.client_name === 'oztop')!
    expect(oz.kind).toBe('not_indexed')
    expect(oz.what).toContain('116 个页面')
    expect(oz.what).toContain('55 个谷歌爬过没收且正文可能偏薄')
    expect(oz.what).toContain('6 个谷歌还不认识这个网址')
    expect(oz.what).toContain('55 个谷歌爬过但暂不收')
    expect(oz.what).not.toContain('爬过却没收录')
    // 🔴 链接落到 ME 站内页面清单（已带 ?filter=not-indexed 直达未收录）——
    //    GSC 网页报告不显示本地「内容太薄」分类、「谷歌还不认识」的页面也可能不在其清单里（Codex #1375）
    expect(oz.href).toBe('https://app.magicengine.com.au/dashboard/clients/oztop/site-audit/pages?filter=not-indexed')
    expect(oz.how).toContain('别反复点请求收录')
  })

  it('资产文件（图片/PDF）不算页面，不计进去', () => {
    const rows: NotIndexedRow[] = [
      page('oztop', 1),
      page('oztop', 2, { url: 'https://site/oztop/logo.png' }),
      page('oztop', 3, { url: 'https://site/oztop/spec.pdf' }),
    ]
    const items = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 个页面')
  })

  it('没有 GSC 连接的客户 → 不下发（没有能直达的清单，给了也白跑）', () => {
    const items = buildNotIndexedItems([page('oztop', 1)], new Map(), nameOf, NOW)
    expect(items).toEqual([])
  })

  it('空输入 → 一条都不出', () => {
    expect(buildNotIndexedItems([], siteUrls, nameOf, NOW)).toEqual([])
  })

  it('跳转页 / 备用页只报一句「不用管」，不算进待办；只剩它们的客户不出待办', () => {
    const onlyRedirects: NotIndexedRow[] = [
      page('cts', 1, { index_verdict: 'Page with redirect' }),
      page('cts', 2, { index_verdict: 'Alternate page with proper canonical tag' }),
    ]
    expect(buildNotIndexedItems(onlyRedirects, siteUrls, nameOf, NOW)).toEqual([])

    const mixed: NotIndexedRow[] = [
      page('cts', 1, { index_verdict: 'Page with redirect', first_not_indexed_at: '2026-06-01T00:00:00Z' }),
      page('cts', 2, { index_verdict: 'Duplicate without user-selected canonical' }),
    ]
    const [item] = buildNotIndexedItems(mixed, siteUrls, nameOf, NOW)
    expect(item.what).toContain('1 个页面')
    expect(item.what).toContain('1 个谷歌判成了重复页')
    expect(item.what).toContain('另 1 个是正常跳转或备用页，不用管')
    // the redirect row's older date must not drive "最久的已 N 天"
    expect(item.what).toContain('最久的已 34 天')
  })

  it('没拿到谷歌结论（ME 兜底 UNKNOWN）的行不算进总数，单独一句', () => {
    const rows: NotIndexedRow[] = [
      page('oztop', 1, { index_verdict: 'UNKNOWN' }),
      page('oztop', 2, { index_verdict: 'Crawled - currently not indexed' }),
    ]
    const [item] = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    expect(item.what).toContain('1 个页面没被谷歌收录')
    expect(item.what).toContain('1 个还没拿到谷歌的结论，排队等重查')
  })

  it('how is built from the shared labels', () => {
    const rows: NotIndexedRow[] = [page('oztop', 1, { index_verdict: 'Crawled - currently not indexed' })]
    const [item] = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    expect(item.how).toContain(`「${INDEX_CLASS_META.error.label}」`)
    expect(item.how).toContain(`「${INDEX_CLASS_META.noindex.label}」的先确认是不是故意的`)
    expect(item.how).toContain(`「${INDEX_CLASS_META.discovered.label}」`)
  })

  it('🔴 被防火墙挡住的行（字数是假的）不判「正文可能偏薄」', () => {
    const rows: NotIndexedRow[] = [
      page('oztop', 1, { word_count: 59, crawl_status: 'antibot_challenged', crawled_at: '2026-09-01T00:00:00Z' }),
    ]
    const [item] = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    expect(item.what).toContain('1 个谷歌爬过但暂不收')
    expect(item.what).not.toContain('偏薄')
  })

  it('🔴 谷歌还没爬的（Discovered）不许说成「爬过」', () => {
    const rows: NotIndexedRow[] = [
      page('oztop', 1, { index_verdict: 'Discovered - currently not indexed', word_count: 59, ...CLEAN }),
    ]
    const [item] = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    expect(item.what).toContain('1 个谷歌发现了但还没来爬')
    expect(item.what).not.toContain('爬过')
  })

  it('报数顺序：先报改了就能好的（打不开 / 写了别收录），再报谷歌排队的', () => {
    const rows: NotIndexedRow[] = [
      page('oztop', 1, { index_verdict: 'Discovered - currently not indexed' }),
      page('oztop', 2, { index_verdict: "Excluded by ‘noindex’ tag" }),
      page('oztop', 3, { index_verdict: 'Not found (404)' }),
    ]
    const [item] = buildNotIndexedItems(rows, siteUrls, nameOf, NOW)
    const w = item.what
    expect(w.indexOf('谷歌打不开或被挡')).toBeLessThan(w.indexOf('页面自己写了「别收录」'))
    expect(w.indexOf('页面自己写了「别收录」')).toBeLessThan(w.indexOf('谷歌发现了但还没来爬'))
  })
})

describe('loadManualItems — 未收录读失败被隔离，不清空整条人工车道（Codex P1）', () => {
  function asClient(x: object): SupabaseClient {
    return x as SupabaseClient
  }

  function loaderStub(opts: { weeklyIds: string[]; crawlRows: CrawlHealthRow[] }) {
    const selects: string[] = []
    const empty = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then')
          return (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(res)
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
        return () => empty
      },
    })
    const weeklyQuery: Record<string, unknown> = {}
    weeklyQuery.not = () => weeklyQuery
    weeklyQuery.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: opts.weeklyIds.map((id) => ({ id })), error: null }).then(res)
    const clientsQuery: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'in']) clientsQuery[m] = () => clientsQuery
    clientsQuery.contains = () => weeklyQuery
    clientsQuery.range = async () => ({ data: [{ id: 'c1', name: 'Client One', domain: 'x' }], error: null })
    let lastSelect = ''
    const csp: Record<string, unknown> = {}
    for (const m of ['not', 'in', 'order']) csp[m] = () => csp
    csp.select = (cols: string) => {
      selects.push(cols)
      lastSelect = cols
      return csp
    }
    csp.limit = async () => ({ data: [], error: null })
    csp.range = async () => ({
      data: lastSelect.includes('first_not_indexed_at') ? [] : opts.crawlRows,
      error: null,
    })
    const stub = asClient({
      from: (table: string) => {
        if (table === 'clients') return clientsQuery
        if (table === 'client_site_pages') return csp
        return empty
      },
    })
    return { stub, selects }
  }

  it('🔴 站点数据健康取数必须带上 crawl_status（漏列会让「数据过期」和「被挡」两条一起悄悄消失）', async () => {
    const { stub, selects } = loaderStub({ weeklyIds: [], crawlRows: [] })

    await loadManualItems(stub, new Date('2026-09-04T00:00:00Z'))

    expect(
      selects.some(
        (s) => s.includes('crawl_status') && s.includes('crawled_at') && !s.includes('first_not_indexed_at'),
      ),
    ).toBe(true)
  })

  it('数据过期只提醒每周重扫名单里的客户', async () => {
    const crawlRows: CrawlHealthRow[] = [
      { client_id: 'c1', crawled_at: '2026-08-01T00:00:00Z', crawl_status: 'crawled' },
    ]
    const NOW = new Date('2026-09-04T00:00:00Z')

    const withClient = await loadManualItems(loaderStub({ weeklyIds: ['c1'], crawlRows }).stub, NOW)
    expect(withClient.some((i) => i.kind === 'crawl_stale' && i.client_id === 'c1')).toBe(true)

    const withoutClient = await loadManualItems(loaderStub({ weeklyIds: [], crawlRows }).stub, NOW)
    expect(withoutClient.some((i) => i.kind === 'crawl_stale')).toBe(false)
  })

  it('client_site_pages 分页读失败 → loadManualItems 不抛、not_indexed 缺席但其他不受牵连', async () => {
    const NOW = new Date('2026-09-04T00:00:00Z')
    const empty = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then')
          return (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(res)
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
        return () => empty
      },
    })
    const clientsQuery = {
      select: () => clientsQuery,
      eq: () => clientsQuery,
      order: () => clientsQuery,
      range: async () => ({ data: [{ id: 'c1', name: 'CTS Tours NZ', domain: 'x' }], error: null }),
    }
    // client_site_pages 被两处查：crawlRows 走 .limit（正常空），
    // notIndexed 的 fetchAll 走 .range（让它抛，模拟分页读失败）。
    const csp: Record<string, unknown> = {}
    for (const m of ['select', 'not', 'in', 'order']) csp[m] = () => csp
    csp.limit = async () => ({ data: [], error: null })
    csp.range = async () => {
      throw new Error('client_site_pages 分页读挂了')
    }
    const stub = {
      from: (table: string) => {
        if (table === 'clients') return clientsQuery
        if (table === 'client_site_pages') return csp
        return empty
      },
    } as unknown as SupabaseClient

    // 关键：没有它自己的 .catch，这里会 reject → daily-todo 把全部人工待办清空。
    const all = await loadManualItems(stub, NOW)
    expect(Array.isArray(all)).toBe(true)
    expect(all.some((i) => i.kind === 'not_indexed')).toBe(false)
  })

  it('🔴 未收录取数必须带上 crawl_status 和 crawled_at（漏列会让「偏薄」悄悄全变成别的类）', async () => {
    const NOW = new Date('2026-09-04T00:00:00Z')
    const empty = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then')
          return (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(res)
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
        return () => empty
      },
    })
    const clientsQuery = {
      select: () => clientsQuery,
      eq: () => clientsQuery,
      order: () => clientsQuery,
      range: async () => ({ data: [{ id: 'c1', name: 'CTS Tours NZ', domain: 'x' }], error: null }),
    }
    const selects: string[] = []
    const csp: Record<string, unknown> = {}
    for (const m of ['not', 'in', 'order']) csp[m] = () => csp
    csp.select = (cols: string) => {
      selects.push(cols)
      return csp
    }
    csp.limit = async () => ({ data: [], error: null })
    csp.range = async () => ({ data: [], error: null })
    const stub = {
      from: (table: string) => {
        if (table === 'clients') return clientsQuery
        if (table === 'client_site_pages') return csp
        return empty
      },
    } as unknown as SupabaseClient

    await loadManualItems(stub, NOW)

    expect(
      selects.some(
        (s) => s.includes('first_not_indexed_at') && s.includes('crawl_status') && s.includes('crawled_at'),
      ),
    ).toBe(true)
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

  // 客户网站上的 ME 插件停了 —— 要转给客户那边（五类里的第 3 类）
  const item: ManualItem = {
    kind: 'meta_stuck',
    client_id: 'cid-2',
    client_name: 'oztop',
    what: '25 条标题/描述改动排了 59 天还没上到网站，说明网站那边的自动应用停了',
    how: '登录客户网站后台看看 Magic Engine 插件是不是被停用了，启用它就会自动补上',
    href: 'https://search.google.com/search-console/inspect?resource_id=x&id=y',
  }

  it('renders what / how / link for each manual item', () => {
    const { html } = buildTodoEmail(3, { ...EMPTY, manualItems: [item] }, '1 Aug')
    expect(html).toContain('要转给客户那边的')
    expect(html).toContain('自动应用停了')
    expect(html).toContain('插件是不是被停用了')
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
    expect(html.indexOf('要转给客户那边的')).toBeLessThan(html.indexOf('Blog 草稿写好了'))
  })

  it('no manual items → section absent, quiet day still says all-clear', () => {
    const email = buildTodoEmail(3, EMPTY, '1 Aug')
    expect(email.html).not.toContain('要转给客户那边的')
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

describe('pushPriceGateItems — href 必须指到「真的能改」的地方，不是随便一个素材库首页', () => {
  const post = { id: 'post-1', client_id: 'c1', title: 'CTS 圣诞团', caption: '圣诞团限时特惠，仅需 NZ$588！' }

  // 同一种 `from(table) => { if (table === ...) return chain }` fixture 写法本文件
  // 537 行已经在用。pushPriceGateItems 只用得到 `.select().eq().order().limit()` /
  // `.maybeSingle()` 这几个方法，`as unknown as SupabaseClient` 只是跳过没用到的其余
  // 接口，不是形状瞎凑——下面两个 it() 已用 vitest 实测跑通，断言的是真实产出的 href/how。
  //
  // client_assets 和 visual_assets 各按 select 的列区分返回哪份罐头数据——
  // 跟真实 supabase 一样，两处调用同一张表，只是查的列不同。
  function fakePriceGateSupabase(opts: {
    postImageUrl: string
    libraryRow: { id: string; source: string } | null
    // 只有素材库没查到时才会走到这一步（provider 判 AI/来源不明）
    visualAssetProvider?: string | null
  }): SupabaseClient {
    const contentPosts = {
      select: () => contentPosts,
      eq: async () => ({ data: [post], error: null }),
    }
    const visualAssets: Record<string, unknown> = {}
    visualAssets.select = (cols: string) => {
      ;(visualAssets as { _cols?: string })._cols = cols
      return visualAssets
    }
    visualAssets.eq = () => visualAssets
    visualAssets.order = () => visualAssets
    visualAssets.limit = () => {
      const cols = (visualAssets as { _cols?: string })._cols
      if (cols === 'storage_url') {
        return Promise.resolve({ data: [{ storage_url: opts.postImageUrl }], error: null })
      }
      // provider 回查（resolveOutgoingImageSource 的第二步）
      const p = Promise.resolve({
        data: opts.visualAssetProvider ? { provider: opts.visualAssetProvider } : null,
        error: null,
      }) as Promise<unknown> & { maybeSingle?: () => Promise<unknown> }
      p.maybeSingle = async () => ({
        data: opts.visualAssetProvider ? { provider: opts.visualAssetProvider } : null,
        error: null,
      })
      return p
    }
    const clientAssets: Record<string, unknown> = {}
    clientAssets.select = () => clientAssets
    clientAssets.eq = () => clientAssets
    clientAssets.limit = () => {
      const p = Promise.resolve({ data: opts.libraryRow, error: null }) as Promise<unknown> & {
        maybeSingle?: () => Promise<unknown>
      }
      p.maybeSingle = async () => ({ data: opts.libraryRow, error: null })
      return p
    }
    return {
      from: (table: string) => {
        if (table === 'content_posts') return contentPosts
        if (table === 'visual_assets') return visualAssets
        if (table === 'client_assets') return clientAssets
        throw new Error(`unexpected table in test: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  it('图在素材库里但没确认 → 链接直接跳到那张图，不是素材库首页', async () => {
    const items: ManualItem[] = []
    const supabase = fakePriceGateSupabase({
      postImageUrl: 'https://img/cts-1.jpg',
      libraryRow: { id: 'asset-99', source: 'client_provided' }, // 上传了但没被确认成真拍
    })
    await pushPriceGateItems(supabase, items, () => 'CTS Tours NZ')

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('price_claim_unbacked')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/assets?highlight=asset-99')
    expect(items[0].how).toContain('直接跳到那张图')
  })

  it('图根本不在素材库里（纯 AI 生成）→ 不指向素材库，只剩「去掉价格」这条真能做的路', async () => {
    const items: ManualItem[] = []
    const supabase = fakePriceGateSupabase({
      postImageUrl: 'https://img/ai-generated.jpg',
      libraryRow: null,
      visualAssetProvider: 'wavespeed',
    })
    await pushPriceGateItems(supabase, items, () => 'CTS Tours NZ')

    expect(items).toHaveLength(1)
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/execution')
    expect(items[0].how).toContain('不在素材库里')
    expect(items[0].how).not.toContain('点这个链接会直接跳到那张图')
  })
})

describe('pushClientDocManualTaskItems — 客户文档里的一次性人工请求必须进今日待办', () => {
  const task = {
    clientId: 'c0000000-0000-0000-0000-000000000000',
    clientName: 'CTS Tours NZ',
    what: '测试用一次性请求',
    how: '测试用做法',
    href: 'https://example.com',
    expiresAt: '2026-09-08T09:00:00+13:00',
  }

  it('还没过期 → 下发待办', () => {
    const items: ManualItem[] = []
    pushClientDocManualTaskItems(items, new Date('2026-09-07T20:00:00Z'), [task])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('client_doc_manual_task')
    expect(items[0].client_id).toBe(task.clientId)
  })

  it('已过期 → 不下发（不用回来手动删）', () => {
    const items: ManualItem[] = []
    pushClientDocManualTaskItems(items, new Date('2026-09-08T20:00:00Z'), [task])
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

/**
 * 客人来信超过一天没人回 —— 这条待办的出口（`email-reply-items.ts`）。
 *
 * 钉的是铁律 3 下半：判据算出来的名单必须**进同一个管道**（今日待办），
 * 而且三件套齐全 —— what 说清是谁和代价、how 具体到点哪里、href 直达。
 *
 * 🔴 href 必须是**绝对网址**：相对路径会被链接闸判成 broken，整条待办被丢掉
 *    （狄仁杰 2026-08-05 实测 kept=0）。这一条单独断言，别跟渲染混在一起。
 */
describe('email_reply_due — 客人来信没人回', () => {
  type Row = Record<string, unknown>

  /** 假 supabase **按表建模**，不按调用次序；没建模的表直接抛，不返回半成品。 */
  function makeFake(tables: Record<string, Row[]>): SupabaseClient {
    const from = (table: string) => {
      if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
      const filters: Array<(r: Row) => boolean> = []
      let lo = 0
      let hi = Number.MAX_SAFE_INTEGER
      const api: Record<string, unknown> = {}
      const chain = () => api
      api.select = () => chain()
      api.order = () => chain()
      api.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain())
      api.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain())
      api.gte = (c: string, v: unknown) =>
        (filters.push((r) => String(r[c]) >= String(v)), chain())
      // 生产写的是 .not('contact_id', 'is', null) —— 只用来排除空值
      api.not = (c: string) => (filters.push((r) => r[c] !== null && r[c] !== undefined), chain())
      api.range = (a: number, b: number) => ((lo = a), (hi = b), chain())
      api.limit = (n: number) => ((hi = n - 1), chain())
      api.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: tables[table]
            .filter((r) => filters.every((f) => f(r)))
            .slice(lo, hi === Number.MAX_SAFE_INTEGER ? undefined : hi + 1),
          error: null,
        }).then(resolve)
      return api
    }
    return { from } as unknown as SupabaseClient
  }

  const CLIENT = 'c0000000-0000-0000-0000-000000000000'
  const NOW = new Date('2026-09-03T09:00:00Z')
  const nameOf = () => 'CTS Tours NZ'

  /**
   * 客人 30 小时前来过一封信，之后没人做过任何事。
   * 他是从广告表单来的（身份来源 meta_lead_form）—— 跟客户打过交道，不算陌生来信。
   */
  function crmTables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
    return {
      conversations: [
        {
          id: 'conv-1',
          client_id: CLIENT,
          contact_id: 'p1',
          channel: 'email',
          subject: '想问 12 月的团还有没有位',
          last_message_at: '2026-09-02T03:00:00Z',
          last_message_from: 'customer',
        },
      ],
      contacts: [{ id: 'p1', do_not_contact: false, display_name: 'Christine Matehaere' }],
      contact_touchpoints: [],
      contact_identities: [
        { contact_id: 'p1', kind: 'email', value: 'christine@gmail.com', first_source: 'meta_lead_form' },
      ],
      clients: [{ id: CLIENT, leads_config: { own_email_domains: ['ctstours.co.nz'] } }],
      cron_run_logs: [],
      ...over,
    }
  }

  async function run(tables: Record<string, Row[]>): Promise<ManualItem[]> {
    const items: ManualItem[] = []
    await pushEmailReplyItems(makeFake(tables), items, [CLIENT], NOW, nameOf)
    return items
  }

  const EMPTY_COUNTS: TodoCounts = {
    draftsByClient: [],
    findingsByClient: [],
    recentCardsByClient: [],
    reelsByClient: [],
    manualItems: [],
    setupTasks: [],
    cronFailures24h: 0,
  }

  it('三件套齐全，且 href 是绝对网址（相对路径会被整条丢掉）', async () => {
    const [item] = await run(crmTables())

    expect(item.kind).toBe('email_reply_due')
    expect(item.client_name).toBe('CTS Tours NZ')
    // what：是谁、等了多久、代价
    expect(item.what).toContain('Christine Matehaere')
    expect(item.what).toContain('30 小时')
    expect(item.what).toContain('想问 12 月的团还有没有位')
    // how：两条路都要求写一笔，否则这条会一直冒到时间窗到期
    expect(item.how).toContain('写一句话记一笔')
    expect(item.how).toContain('30 天')
    // 🔴 绝对网址，且落点是「全部客人」那一页（`?contact=` 那页真的读）
    expect(item.href.startsWith('https://app.magicengine.com.au/')).toBe(true)
    expect(item.href).toBe(
      `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all?contact=p1`,
    )
  })

  it('真的渲染进今日待办，并计入主题里的总数', async () => {
    const items = await run(crmTables())
    const email = buildTodoEmail(3, { ...EMPTY_COUNTS, manualItems: items }, '3 Sep')

    expect(email.totalItems).toBe(1)
    expect(email.subject).toContain('1 件')
    expect(email.html).toContain('要转给客户那边的')
    expect(email.html).toContain('Christine Matehaere')
    expect(email.html).toContain('去做这件事')
  })

  it('球在客人那边（最后说话的是我们）→ 一条都不下发，整栏不出现', async () => {
    const answered = crmTables({
      conversations: [
        {
          id: 'conv-1',
          client_id: CLIENT,
          contact_id: 'p1',
          channel: 'email',
          subject: '想问 12 月的团还有没有位',
          last_message_at: '2026-09-02T03:00:00Z',
          last_message_from: 'page',
        },
      ],
    })
    const items = await run(answered)
    expect(items).toEqual([])

    // 空名单不该变成一栏空标题 —— 安静的一天要真的安静
    const email = buildTodoEmail(3, { ...EMPTY_COUNTS, manualItems: items }, '3 Sep')
    expect(email.html).not.toContain('要转给客户那边的')
    expect(email.html).toContain('今天没有待办')
  })

  /**
   * 这条通道查挂了，其它待办必须照常下发。
   *
   * `loadManualItems` 里那一行 `.catch` 就是为这件事存在的：没有它，一次读库
   * 失败会让整份今日待办变成空信，而空信跟「今天没事」长得一模一样。
   */
  it('上游查挂了 → 其他待办照常下发，不把整份清单带崩', async () => {
    const empty = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(res)
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
        return () => empty
      },
    })
    const clientsQuery = {
      select: () => clientsQuery,
      eq: () => clientsQuery,
      order: () => clientsQuery,
      range: async () => ({
        data: [{ id: CLIENT, name: 'CTS Tours NZ', domain: 'ctstours.co.nz' }],
        error: null,
      }),
    }
    const broken = {
      from: (table: string) => {
        // 邮件那条通道的第一张表 —— 让它当场炸，模拟读库失败
        if (table === 'conversations') throw new Error('conversations 读挂了')
        if (table === 'clients') return clientsQuery
        return empty
      },
    } as unknown as SupabaseClient

    const all = await loadManualItems(broken, NOW)

    expect(all.some((i) => i.kind === 'email_reply_due')).toBe(false)
    // 其它通道照常产出 —— 这才是 .catch 存在的意义
    expect(all.length).toBeGreaterThan(0)
  })

  /**
   * 「今天信压根没进来」必须跟结果并排出现。
   *
   * 邮箱授权掉了 → 一封新信都没同步进来 → 超时未回自然是零条 → 这一栏干干净净。
   * **一个哑掉的通道和一个健康的通道，在待办清单里长得一模一样。**
   */
  const syncRun = (summary: unknown, finishedAt = '2026-09-03T08:10:00Z'): Row => ({
    job_name: 'messenger-sync-hourly',
    status: 'completed',
    started_at: finishedAt,
    finished_at: finishedAt,
    summary,
  })

  /**
   * 一行「开跑了还没写完」的记录 —— `startCronRun` 在任务**开始时**就插这一行，
   * summary 要 finish() 才写。照真形状建模：status='running'、summary=null。
   */
  const runningRun = (startedAt: string): Row => ({
    job_name: 'messenger-sync-hourly',
    status: 'running',
    started_at: startedAt,
    finished_at: null,
    summary: null,
  })

  it('公司邮箱同步整趟挂了 → 单独下发一条，说明那个「零条」是假的', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [syncRun({ mailbox: { mailboxes: 1, error: '令牌过期', results: [] } })],
      }),
    )

    expect(items).toHaveLength(1)
    // 整趟挂了是我们要修的（开发的活），PM 清单顶上会因此出一句「今天没查成」
    expect(items[0].kind).toBe('email_sync_broken')
    expect(items[0].what).toContain('令牌过期')
    expect(items[0].what).toContain('别把它当成「没人在等」')
    expect(items[0].href.startsWith('https://app.magicengine.com.au/')).toBe(true)
  })

  it('单个邮箱读不进来 → 挂到它自己的客户名下，链接直达那个客户的设置页', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          syncRun({
            mailbox: {
              mailboxes: 1,
              error: null,
              results: [{ clientId: CLIENT, mailbox: 'info@ctstours.co.nz', error: '401 授权失效' }],
            },
          }),
        ],
      }),
    )

    expect(items).toHaveLength(1)
    // 读不进来多半是授权掉了 —— 要人点一次，留在 PM 的清单里
    expect(items[0].kind).toBe('email_sync_stale')
    expect(items[0].client_name).toBe('CTS Tours NZ')
    expect(items[0].what).toContain('info@ctstours.co.nz')
    expect(items[0].how).toContain('重新授权')
    expect(items[0].href).toBe(
      `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/settings`,
    )
  })

  it('运行记录太旧 → 闭嘴（「该跑没跑」有别的通道在管，不重复报）', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          syncRun({ mailbox: { mailboxes: 0 } }, '2026-08-20T08:10:00Z'),
        ],
      }),
    )
    expect(items).toEqual([])
  })

  /**
   * 🔴 守卫不许在最需要它的那一刻自己失效。
   *
   * 最新一行随时可能是刚插进去、还没写 summary 的 'running' 行。只看第一行的话，
   * 「邮箱同步挂了」这条通道就在同步刚出事的那一刻静音 —— fail-open。
   * 假件按真形状建模（假 supabase 的 .order() 是空操作，所以这里按
   * started_at 倒序手工摆好，跟生产读到的顺序一致）。
   */
  it('🔴 最新一行还在「在跑」→ 往下找写完的那一轮，不许整条通道闭嘴', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          runningRun('2026-09-03T08:50:00Z'),
          syncRun({ mailbox: { mailboxes: 1, error: '令牌过期', results: [] } }),
        ],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('email_sync_broken')
    expect(items[0].what).toContain('令牌过期')
  })

  it('同步开跑 5 小时没写完 → 当卡死单独说，不跟「记录太旧」一起吞掉', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [runningRun('2026-09-03T04:00:00Z')],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('email_sync_broken')
    expect(items[0].what).toContain('卡住了')
    expect(items[0].href.startsWith('https://app.magicengine.com.au/')).toBe(true)
  })

  it('刚开跑一个小时 → 那是正常在跑，闭嘴', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [runningRun('2026-09-03T08:00:00Z')],
      }),
    )
    expect(items).toEqual([])
  })

  /**
   * 不再封顶：同一个客户 13 封都下发，今日待办把它们合成一行、带着人数
   * （以前一页只列 10 封 + 一条「还有 3 封没列出来」）。
   */
  it('13 封都下发，渲染时合成一行「共 13 条同类」，不再有「还有 N 封没列」', async () => {
    const convos = Array.from({ length: 13 }, (_, i) => ({
      id: `conv-${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'email',
      subject: `问团 ${i}`,
      last_message_at: '2026-09-02T03:00:00Z',
      last_message_from: 'customer',
    }))
    const items = await run(
      crmTables({
        conversations: convos,
        contacts: convos.map((c) => ({
          id: c.contact_id,
          do_not_contact: false,
          display_name: `客人 ${c.contact_id}`,
        })),
        contact_identities: convos.map((c) => ({
          contact_id: c.contact_id, kind: 'email', value: `${c.contact_id}@gmail.com`, first_source: 'web_form',
        })),
      }),
    )

    expect(items.filter((i) => i.kind === 'email_reply_due')).toHaveLength(13)
    expect(items.some((i) => i.what.includes('没有列出来'))).toBe(false)

    const email = buildTodoEmail(3, { ...EMPTY_COUNTS, manualItems: items }, '3 Sep')
    expect(email.totalItems).toBe(1)
    expect(email.html).toContain('共 13 条同类')
    // 合并后的链接落到这个客户的「全部客人」，不带某一个人的 contact 参数
    expect(email.html).toContain(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all"`)
  })

  /**
   * 陌生地址第一次来信（2026-09-25：CTS 待回 42 人里 10 个是推销）。
   * 判据只看库里的事实：我们给他写过信 / 从别的渠道来过 / 在邮件名单上 / 身份来自表单或私信。
   * 一条都没有的挪进一行「N 封陌生来信」—— **不丢**，真客人的第一封询价也长这样。
   */
  describe('陌生地址第一次来信', () => {
    const pitch = (id: string, subject: string, hoursAgo: number): Row => ({
      id: `conv-${id}`,
      client_id: CLIENT,
      contact_id: id,
      channel: 'email',
      subject,
      last_message_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      last_message_from: 'customer',
    })

    it('没有任何往来记录的人不按「客人来信」一人一条，合成一条带主题的陌生来信', async () => {
      const items = await run(
        crmTables({
          conversations: [
            pitch('p1', '想问 12 月的团还有没有位', 30),
            pitch('v1', 'Want to offer customers a better way to pay?', 700),
            pitch('v2', 'Local Japan Experiences for Your Clients', 100),
          ],
          contacts: [
            { id: 'p1', do_not_contact: false, display_name: 'Christine Matehaere' },
            { id: 'v1', do_not_contact: false, display_name: 'Afterpay Team' },
            { id: 'v2', do_not_contact: false, display_name: 'kanpai' },
          ],
          contact_identities: [
            { contact_id: 'p1', kind: 'email', value: 'christine@gmail.com', first_source: 'meta_lead_form' },
            // 7 月从邮箱批量导入的来源 'outlook' 不算「主动找上门」
            { contact_id: 'v1', kind: 'email', value: 'news@afterpay.example', first_source: 'outlook' },
            { contact_id: 'v2', kind: 'email', value: 'hi@kanpai.example', first_source: 'email' },
          ],
        }),
      )

      const due = items.filter((i) => i.kind === 'email_reply_due')
      expect(due).toHaveLength(1)
      expect(due[0].what).toContain('Christine Matehaere')

      const strangers = items.filter((i) => i.kind === 'email_first_contact')
      expect(strangers).toHaveLength(1)
      expect(strangers[0].what).toContain('2 封陌生地址')
      // 新来的在前：真询价多半是最近才来的
      expect(strangers[0].what.indexOf('kanpai')).toBeLessThan(strangers[0].what.indexOf('Afterpay'))
      expect(strangers[0].how).toContain('不是客人')
      expect(strangers[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all`)
    })

    it('我们给他写过信 / 在邮件名单上 / 私信来过 → 算打过交道，照常一人一条', async () => {
      const items = await run(
        crmTables({
          conversations: [pitch('a', 'Re: Quote please', 50), pitch('b', 'Re: Your China itinerary', 50), pitch('c', 'hello', 50)],
          contacts: [
            { id: 'a', do_not_contact: false, display_name: 'Andrea' },
            { id: 'b', do_not_contact: false, display_name: 'Sharyn' },
            { id: 'c', do_not_contact: false, display_name: 'Eva' },
          ],
          contact_identities: [
            { contact_id: 'a', kind: 'email', value: 'a@gmail.com', first_source: 'email' },
            { contact_id: 'b', kind: 'email', value: 'b@yahoo.example', first_source: 'email' },
            { contact_id: 'c', kind: 'email', value: 'c@msn.example', first_source: 'email' },
          ],
          contact_touchpoints: [
            { contact_id: 'a', occurred_at: '2026-08-01T00:00:00Z', channel: 'email', direction: 'outbound', source: 'microsoft_mail', metadata: { automated: false } },
            { contact_id: 'b', occurred_at: '2026-08-30T00:00:00Z', channel: 'email', direction: 'inbound', source: 'mailchimp', metadata: {} },
            { contact_id: 'c', occurred_at: '2026-08-01T00:00:00Z', channel: 'messenger', direction: 'inbound', source: 'messenger', metadata: {} },
          ],
        }),
      )
      expect(items.filter((i) => i.kind === 'email_reply_due')).toHaveLength(3)
      expect(items.some((i) => i.kind === 'email_first_contact')).toBe(false)
    })

    it('🔴 员工手记（me_manual）和机器自动回执不算打过交道', async () => {
      const items = await run(
        crmTables({
          conversations: [pitch('v', 'Participate to International Travel Experience', 60)],
          contacts: [{ id: 'v', do_not_contact: false, display_name: 'Bitesp' }],
          contact_identities: [{ contact_id: 'v', kind: 'email', value: 'x@bitesp.example', first_source: 'email' }],
          contact_touchpoints: [
            // 手记写在来信之前（之后的话会被「有人处理过了」那条直接挡掉）
            { contact_id: 'v', occurred_at: '2026-08-01T00:00:00Z', channel: 'phone', direction: 'outbound', source: 'me_manual', metadata: {} },
            { contact_id: 'v', occurred_at: '2026-08-02T00:00:00Z', channel: 'email', direction: 'outbound', source: 'microsoft_mail', metadata: { automated: true } },
          ],
        }),
      )
      expect(items.map((i) => i.kind)).toEqual(['email_first_contact'])
    })

    it('网站表单通知（主题带 Contact form）算真询价，照常一人一条', async () => {
      const items = await run(
        crmTables({
          conversations: [pitch('f', 'Re: Contact form: General Inquiry — Lyndsay', 40)],
          contacts: [{ id: 'f', do_not_contact: false, display_name: 'Lyndsay' }],
          contact_identities: [{ contact_id: 'f', kind: 'email', value: 'l@gmail.com', first_source: 'email' }],
        }),
      )
      expect(items.map((i) => i.kind)).toEqual(['email_reply_due'])
    })

    it('ME 自己信箱发来的（[PREVIEW] 自测）对每个客户都算自己人，不列', async () => {
      const items = await run(
        crmTables({
          conversations: [pitch('me', '[PREVIEW] Welcome to CTS Tours', 60)],
          contacts: [{ id: 'me', do_not_contact: false, display_name: 'Big Ray Deng' }],
          contact_identities: [{ contact_id: 'me', kind: 'email', value: 'hello@magicengine.cloud', first_source: 'email' }],
          contact_touchpoints: [
            { contact_id: 'me', occurred_at: '2026-08-19T00:00:00Z', channel: 'email', direction: 'outbound', source: 'microsoft_mail', metadata: { automated: false } },
          ],
        }),
      )
      expect(items).toEqual([])
    })
  })
})

/**
 * href 必须绝对 —— 相对路径会被 `verifyActionLink` 里的 `new URL()` 抛错，
 * 判成 broken，整条被 `dropBrokenLinks` 静默丢掉（=PM 邮件里根本看不到）。
 * 同一个 bug 早在 `cross_client_leak`（2026-08-05）上治过一次；2026-09-07 的
 * 每日待办 href 审计（PR #1467）又抓到 3 个 kind 犯了同一个 bug。加这道
 * fail-fast 让下次再有人写相对路径时立刻在 build/test 阶段炸出来。
 *
 * `assertAbsoluteHref` 本身仍然对单条 throw，给 build/test 直接调用来
 * fail-fast；但 `dropBrokenLinks` 内部逐条 catch 它，绝不对着整批 items
 * 同步抛错 —— 唯一的生产调用方 daily-todo.ts 在 dropBrokenLinks 整体失败
 * 时会兜底放行未过滤的 rawManualItems，一条相对路径同步抛错会把这条 bug
 * 静默升级成「所有链接（含真正打不开的）原样下发且不留日志」，比原来单条
 * 静默丢弃更糟（Codex review, PR #1471）。
 */
describe('assertAbsoluteHref (fail-fast on relative href)', () => {
  const base = (partial: Partial<ManualItem> = {}): ManualItem => ({
    kind: 'not_indexed' as ManualItem['kind'],
    client_id: 'c0000000-0000-0000-0000-000000000000',
    client_name: 'CTS',
    what: 'x',
    how: 'y',
    href: 'https://app.magicengine.com.au/dashboard/x',
    ...partial,
  })

  it('accepts absolute https URLs', () => {
    expect(() => assertAbsoluteHref(base())).not.toThrow()
  })

  it('accepts http URLs (external legacy)', () => {
    expect(() => assertAbsoluteHref(base({ href: 'http://internal.example/x' }))).not.toThrow()
  })

  it('accepts empty href (some items intentionally have no entry point)', () => {
    expect(() => assertAbsoluteHref(base({ href: '' }))).not.toThrow()
  })

  it('rejects relative paths starting with /', () => {
    expect(() => assertAbsoluteHref(base({ href: '/dashboard/clients/xxx/blog' }))).toThrow(
      /href 必须是绝对网址/,
    )
  })

  it('rejects protocol-relative //host paths (would break new URL() the same way)', () => {
    expect(() => assertAbsoluteHref(base({ href: '//app.magicengine.com.au/x' }))).toThrow(
      /href 必须是绝对网址/,
    )
  })

  it('dropBrokenLinks drops only the offending relative-href item, and still verifies the rest', async () => {
    const bad = base({ kind: 'blog_pr_open', href: '/dashboard/conversions?client=x' })
    const good = base({ kind: 'not_indexed', href: 'https://good.example/ok' })
    const fetchImpl = (async (url: string) =>
      ({ ok: url === good.href }) as Response) as unknown as typeof fetch

    const { kept, dropped } = await dropBrokenLinks([bad, good], fetchImpl)

    expect(dropped.map((i) => i.href)).toEqual([bad.href])
    expect(kept.map((i) => i.href)).toEqual([good.href])
  })

  it('dropBrokenLinks still ships NEVER_DROP_KINDS items even when their href is relative', async () => {
    // cross_client_leak 早就在 NEVER_DROP_KINDS 里（2026-08-05 狄仁杰实测 kept=0
    // 治过）——一个真正打不开的链接不该让红线条目消失，相对路径同样不该。
    const item = base({ kind: 'cross_client_leak', href: '/dashboard/clients/xxx' })
    const { kept, dropped } = await dropBrokenLinks([item])
    expect(dropped).toEqual([])
    expect(kept.map((i) => i.href)).toEqual([item.href])
  })
})

describe('buildCrawlHealthItems — 站点数据健康：只认真抓到的，被挡单独下发', () => {
  const NOW = new Date('2026-09-26T00:00:00Z')
  const nameOf = (id: string) => id

  const row = (
    client_id: string,
    over: Partial<CrawlHealthRow> = {},
  ): CrawlHealthRow => ({
    client_id,
    crawled_at: null,
    crawl_status: null,
    ...over,
  })

  it('🔴 被挡页刷新了抓取时间也不许把「数据过期」告警静音', () => {
    const items = buildCrawlHealthItems(
      [
        row('oztop', { crawl_status: 'crawled', crawled_at: '2026-09-01T00:00:00Z' }),
        row('oztop', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-25T00:00:00Z' }),
      ],
      nameOf,
      NOW,
      new Set(['oztop']),
    )

    const stale = items.find((i) => i.kind === 'crawl_stale')
    expect(stale?.client_id).toBe('oztop')
    expect(stale?.what).toContain('25 天没更新')

    const blocked = items.find((i) => i.kind === 'crawl_blocked')
    expect(blocked?.what.startsWith('最近 14 天里有 1 个页面被客户网站的防火墙挡住')).toBe(true)
    expect(blocked?.href).toBe(SITE_FIREWALL_ALLOWLIST_SOP_URL)
  })

  it('fresh real crawl and nothing blocked → no items', () => {
    const items = buildCrawlHealthItems(
      [row('cts', { crawl_status: 'crawled', crawled_at: '2026-09-24T00:00:00Z' })],
      nameOf,
      NOW,
      new Set(['cts']),
    )
    expect(items).toEqual([])
  })

  it('only blocked rows (never a real crawl) → crawl_blocked only, no crawl_stale', () => {
    const items = buildCrawlHealthItems(
      [
        row('x', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-25T00:00:00Z' }),
        row('x', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-24T00:00:00Z' }),
      ],
      nameOf,
      NOW,
      new Set(['x']),
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('crawl_blocked')
    expect(items[0].what.startsWith('最近 14 天里有 2 个页面')).toBe(true)
  })

  it('rows with crawl_status pending / failed do not count as fresh', () => {
    const items = buildCrawlHealthItems(
      [
        row('y', { crawl_status: 'crawled', crawled_at: '2026-09-01T00:00:00Z' }),
        row('y', { crawl_status: 'failed', crawled_at: '2026-09-25T00:00:00Z' }),
      ],
      nameOf,
      NOW,
      new Set(['y']),
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('crawl_stale')
  })

  it('stale data only nags clients on the weekly recrawl list', () => {
    const rows = [row('roman', { crawl_status: 'crawled', crawled_at: '2026-08-17T00:00:00Z' })]

    expect(buildCrawlHealthItems(rows, nameOf, NOW, new Set<string>())).toEqual([])

    const items = buildCrawlHealthItems(rows, nameOf, NOW, new Set(['roman']))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('crawl_stale')
  })

  it('blocked rows older than 14 days no longer count', () => {
    const items = buildCrawlHealthItems(
      [
        row('z', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-01T00:00:00Z' }),
        row('z', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-24T00:00:00Z' }),
        row('w', { crawl_status: 'antibot_challenged', crawled_at: '2026-08-20T00:00:00Z' }),
        row('v', { crawl_status: 'antibot_challenged', crawled_at: null }),
      ],
      nameOf,
      NOW,
      new Set<string>(),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('crawl_blocked')
    expect(items[0].client_id).toBe('z')
    expect(items[0].what.startsWith('最近 14 天里有 1 个页面')).toBe(true)
  })

  it('crawl_blocked does not send the reader to the client first', () => {
    const items = buildCrawlHealthItems(
      [row('q', { crawl_status: 'antibot_challenged', crawled_at: '2026-09-25T00:00:00Z' })],
      nameOf,
      NOW,
      new Set<string>(),
    )

    expect(items).toHaveLength(1)
    expect(items[0].how).toContain('先别找客户')
    expect(items[0].how).toContain('换通道')
    expect(items[0].how).not.toContain('Start New Audit')
    expect(items[0].href).toBe(SITE_FIREWALL_ALLOWLIST_SOP_URL)
  })
})

describe('NOT_INDEXED_REPORT_ORDER — every class that is real work is reported', () => {
  it('lists exactly the actionable classes', () => {
    const actionable = (Object.keys(INDEX_CLASS_META) as IndexClass[]).filter(isActionableNotIndexed)
    expect([...NOT_INDEXED_REPORT_ORDER].sort()).toEqual([...actionable].sort())
  })
})
