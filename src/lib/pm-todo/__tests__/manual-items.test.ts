/**
 * Unit tests for the pure helpers of the manual handoff lane, plus the
 * to-do email's rendering of it (PM 拍板 2026-08-01: 管道不许断头).
 */

import { describe, it, expect } from 'vitest'
import { gscInspectUrl, daysAgo, loadManualItems, type ManualItem } from '../manual-items'
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
    expect(html).toContain(item.href)
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

describe('cron_never_ran — 新 cron 没关联密钥组时必须冒出来', () => {
  // 为什么要有这条测试：这类失败在应用侧**完全没有痕迹**（curl 层就 401 了，
  // cron_run_logs 一行都不会写）。daily-cron-digest 只报「跑了但失败」，
  // 看不见「压根没跑」—— 它自己就这么哑了 51 天。
  function supabaseWith(cronRows: Array<{ job_name: string }>) {
    const table = (name: string) => {
      const rows = name === 'cron_run_logs' ? cronRows : []
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit', 'gte', 'is']) {
        chain[m] = self
      }
      chain.limit = () => Promise.resolve({ data: rows })
      chain.then = (res: (v: { data: unknown }) => unknown) => res({ data: rows })
      return chain
    }
    return { from: (name: string) => table(name) } as never
  }

  it('从来没跑过 → 给出一条能直接照做的人工任务', async () => {
    const items = await loadManualItems(supabaseWith([]))
    const cron = items.find((i) => i.kind === 'cron_never_ran')
    expect(cron).toBeTruthy()
    expect(cron!.what).toContain('一次都没跑成功过')
    // 三件套缺一不可：说清影响 / 具体怎么点 / 直达链接
    expect(cron!.how).toContain('me-shared-cron-secret')
    expect(cron!.href).toContain('dashboard.render.com')
  })

  it('已经跑过的那个不再打扰 PM，还没跑过的照旧要报', async () => {
    // 名单里现在有好几个 cron。跑过的应该消失，没跑过的必须还在 ——
    // 首版这里断言的是「一条都不剩」，那只在名单只有一个的时候成立，
    // 名单一加东西就红，而红的原因跟被测行为无关。
    const items = await loadManualItems(supabaseWith([{ job_name: 'team-memory-sweeper' }]))
    const never = items.filter((i) => i.kind === 'cron_never_ran')
    expect(never.some((i) => i.what.includes('团队工作记忆兜底清扫'))).toBe(false)
    expect(never.length).toBeGreaterThan(0)
  })
})
