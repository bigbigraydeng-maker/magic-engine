/**
 * Unit tests for the pure email-building logic in daily-todo.ts.
 * (loadTodoCounts is a thin Supabase read verified at integration time.)
 */

import { describe, it, expect, vi } from 'vitest'
import { buildTodoEmail, loadGbpSetupTasks, nzWeekday, type TodoCounts } from '../daily-todo'

const EMPTY: TodoCounts = {
  setupTasks: [],
  draftsByClient: [],
  findingsByClient: [],
  recentCardsByClient: [],
  reelsByClient: [],
  manualItems: [],
  cronFailures24h: 0,
}

describe('buildTodoEmail · setup tasks', () => {
  const SETUP: TodoCounts['setupTasks'] = [
    {
      name: 'CTS Tours NZ',
      id: 'cid-1',
      label: '连接 Google 商家页（点一次授权，之后自动发帖）',
      href: 'https://app.magicengine.com.au/api/auth/google/google/connect?client_id=cid-1',
    },
    {
      name: 'oztop',
      id: 'cid-2',
      label: '连接 Google 商家页（点一次授权，之后自动发帖）',
      href: 'https://app.magicengine.com.au/api/auth/google/google/connect?client_id=cid-2',
    },
  ]

  it('renders one authorise link per client and counts into the total', () => {
    const email = buildTodoEmail(3, { ...EMPTY, setupTasks: SETUP }, '1 Aug')

    expect(email.totalItems).toBe(2)
    expect(email.subject).toContain('2 件')
    expect(email.html).toContain('去连接')
    expect(email.html).toContain('google/connect?client_id=cid-1')
    expect(email.html).toContain('google/connect?client_id=cid-2')
  })

  it('setup card is rendered above the routine review queues', () => {
    const email = buildTodoEmail(2, {
      ...EMPTY,
      setupTasks: SETUP.slice(0, 1),
      draftsByClient: [{ name: 'oztop', id: 'cid-2', drafts: 3 }],
    }, '1 Aug')

    const setupAt = email.html.indexOf('去连接')
    const draftsAt = email.html.indexOf('Blog 草稿写好了')
    expect(setupAt).toBeGreaterThan(-1)
    expect(draftsAt).toBeGreaterThan(-1)
    expect(setupAt).toBeLessThan(draftsAt)
    // 一行 = 一件事：连接 1 件 + oztop 的 3 篇草稿 1 件
    expect(email.totalItems).toBe(2)
  })

  it('no setup card once every client is authorised', () => {
    const email = buildTodoEmail(3, { ...EMPTY, draftsByClient: [{ name: 'x', id: 'y', drafts: 1 }] }, '1 Aug')
    expect(email.html).not.toContain('去连接')
  })
})

describe('loadGbpSetupTasks', () => {
  const makeSupabase = (
    clients: Array<{ id: string; name: string }>,
    connections: Array<{ client_id: string; status: string; location_name: string | null }>,
  ) => ({
    from: vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: clients }) }) }),
        }
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: connections }) }) }
    }),
  })

  const CLIENTS = [
    { id: 'cts', name: 'CTS Tours NZ' },
    { id: 'oz', name: 'oztop' },
  ]

  it('lists clients with no connection at all', async () => {
    const tasks = await loadGbpSetupTasks(makeSupabase(CLIENTS, []) as never)
    expect(tasks.map((t) => t.id)).toEqual(['cts', 'oz'])
    // 2026-09-07 铁律 3：合并流一次授权覆盖 GBP + GSC + GA4 + Indexing
    expect(tasks[0].href).toContain('/api/auth/google/connect?client_id=cts')
    expect(tasks[0].href).not.toContain('gbp/start')
  })

  it('a connected client WITHOUT a confirmed storefront stays on the list', async () => {
    // 板桥 必改 3: 这条以前第二天就消失了，PM 会以为办完了，
    // 实际上这个客户一条内容都发不出去。
    const tasks = await loadGbpSetupTasks(
      makeSupabase(CLIENTS, [
        { client_id: 'cts', status: 'active', location_name: null },
        { client_id: 'oz', status: 'active', location_name: 'accounts/1/locations/2' },
      ]) as never,
    )
    expect(tasks.map((t) => t.id)).toEqual(['cts'])
    expect(tasks[0].label).toContain('哪一家门店')
    expect(tasks[0].href).toContain('/settings')
  })

  it('an errored connection needs the consent click again', async () => {
    const tasks = await loadGbpSetupTasks(
      makeSupabase(CLIENTS, [
        { client_id: 'cts', status: 'error', location_name: 'accounts/1/locations/2' },
        { client_id: 'oz', status: 'active', location_name: 'accounts/1/locations/3' },
      ]) as never,
    )
    expect(tasks.map((t) => t.id)).toEqual(['cts'])
    expect(tasks[0].href).toContain('/api/auth/google/connect?client_id=cts')
  })

  it('fully set up → empty list', async () => {
    const tasks = await loadGbpSetupTasks(
      makeSupabase(CLIENTS, [
        { client_id: 'cts', status: 'active', location_name: 'accounts/1/locations/2' },
        { client_id: 'oz', status: 'active', location_name: 'accounts/1/locations/3' },
      ]) as never,
    )
    expect(tasks).toEqual([])
  })
})

describe('buildTodoEmail', () => {
  it('quiet day → all-clear subject and body, no section cards', () => {
    const email = buildTodoEmail(2, EMPTY, '31 Jul')
    expect(email.totalItems).toBe(0)
    expect(email.subject).toContain('无事')
    expect(email.html).toContain('今天没有待办')
    expect(email.html).not.toContain('去处理')
  })

  it('drafts show one row per client with a deep link; SEO patrol findings are not in the daily list at all', () => {
    const email = buildTodoEmail(1, {
      ...EMPTY,
      draftsByClient: [
        { name: 'CTS Tours NZ', id: 'cid-1', drafts: 7 },
        { name: 'oztop', id: 'cid-2', drafts: 7 },
      ],
      findingsByClient: [{ name: 'oztop', id: 'cid-2', findings: 3 }],
    }, '31 Jul')

    // 🔴 一行一件事：两个客户各一行草稿 = 2 件（以前按篇数算成 14 件）。
    //    巡逻发现 2026-09-26 起整栏拿出每日待办 —— 周报里有「巡逻员本周抓到 N 个新发现」。
    expect(email.totalItems).toBe(2)
    expect(email.subject).toContain('2 件')
    expect(email.html).toContain('/clients/cid-1/blog')
    expect(email.html).toContain('7 篇 Blog 草稿写好了')
    expect(email.html).toContain('发出去前要你看一眼的')
    expect(email.html).not.toContain('SEO 巡逻')
    expect(email.html).not.toContain('/clients/cid-2/execution')
  })

  it('🔴 巡逻发现再多也不抬高「今天有几件」—— 那是建议卡的原料，不是另一批活', () => {
    const many = buildTodoEmail(1, {
      ...EMPTY,
      findingsByClient: [{ name: 'oztop', id: 'cid-2', findings: 34 }],
    }, '31 Jul')
    expect(many.totalItems).toBe(0)
    expect(many.subject).toContain('无事')
  })

  /**
   * 2026-09-07 铁律 3：以下 kind 是**我们代码 / infra 欠账**——每条的 how
   * 都是「回我一句我去改」，PM 没法真的动手。2026-09-26 起（PM：今日待办只留五类）
   * 它们连一栏都不占了：PM 邮件里只剩一行「N 件开发欠账」+ 后台清单链接，不抬高总数。
   */
  it.each([
    'auto_run_stuck',
    'action_unattributable',
    'attribution_audit_failed',
    'client_list_unreadable',
    'cron_blind',
  ] as const)('🛠 %s 只在「开发欠账」那一行小字里出现，不抬高总数', (kind) => {
    const email = buildTodoEmail(3, {
      ...EMPTY,
      manualItems: [
        {
          kind,
          client_id: 'infra',
          client_name: 'Magic Engine 后台',
          what: '（dev 该看的）',
          how: '回我一句我去改',
          href: 'https://app.magicengine.com.au/dashboard/admin/cron-health',
        },
      ],
    }, '31 Jul')
    expect(email.html).toContain('1 件开发欠账')
    expect(email.html).toContain('/dashboard/admin/cron-health#dev-debt')
    expect(email.html).not.toContain('（dev 该看的）')
    expect(email.totalItems).toBe(0)
    expect(email.subject).toContain('无事')
  })

  it('🛠 开发欠账与 PM 的事共存时，只有 PM 的事算进总数', () => {
    const email = buildTodoEmail(3, {
      ...EMPTY,
      manualItems: [
        {
          kind: 'video_credits_out',
          client_id: 'infra',
          client_name: 'Magic Engine 后台',
          what: 'AI 出片余额用完了',
          how: '打开链接充值',
          href: 'https://muapi.ai/topup',
        },
        {
          kind: 'action_unattributable',
          client_id: 'infra',
          client_name: 'Magic Engine 后台',
          what: '（dev 该看的）',
          how: '回我一句我去改',
          href: '',
        },
      ],
    }, '31 Jul')
    expect(email.html).toContain('系统进不去、要你点一次的')
    expect(email.html).toContain('1 件开发欠账')
    // 只有 video_credits_out 算一件
    expect(email.totalItems).toBe(1)
    expect(email.subject).toContain('1 件')
  })

  /**
   * 2026-09-26 PM：「这周系统替你做了什么」是知会，挪到周一周报（weekly-report/build.ts）。
   * 每日待办里只剩一行「N 件系统知会挪到周一周报」，不抬高总数。
   */
  it('🔴 本周体检结果挪去周报，每日待办只说一句挪走了，不抬高总数', () => {
    const email = buildTodoEmail(3, {
      ...EMPTY,
      manualItems: [
        {
          kind: 'diagnostic_findings',
          client_id: 'cid-1',
          client_name: 'CTS Tours NZ',
          what: '本周体检查出 3 个严重、5 个高优先问题。最要紧的一条：首页 H1 缺失',
          how: '不用你挑 —— 每周方案会把这些自动排成看板上的动作',
          href: 'https://app.magicengine.com.au/dashboard/clients/cid-1/execution',
        },
      ],
    }, '31 Jul')
    expect(email.html).not.toContain('首页 H1 缺失')
    expect(email.html).toContain('1 件系统知会挪到周一周报')
    // 不抬高总数
    expect(email.totalItems).toBe(0)
    expect(email.subject).toContain('无事')
  })

  it('cron failures are developer work: one small line with the list link, never counted', () => {
    const email = buildTodoEmail(3, {
      ...EMPTY,
      cronFailures24h: 2,
    }, '31 Jul')
    expect(email.html).not.toContain('Blog 草稿写好了')
    expect(email.html).toContain('过去 24 小时 2 次自动任务失败')
    expect(email.html).toContain('/dashboard/admin/cron-health#dev-debt')
    expect(email.totalItems).toBe(0)
  })

  it('reels awaiting review are one review row per client with the factory link', () => {
    const email = buildTodoEmail(4, {
      ...EMPTY,
      reelsByClient: [{ name: 'CTS Tours NZ', id: 'cid-1', reels: 11 }],
    }, '1 Aug')
    expect(email.totalItems).toBe(1)
    expect(email.html).toContain('11 条社媒成片等你审')
    expect(email.html).toContain('/dashboard/factory')
  })

  it('weekday theme appears in the header', () => {
    expect(buildTodoEmail(1, EMPTY, 'x').html).toContain('周报日')
    expect(buildTodoEmail(2, EMPTY, 'x').html).toContain('Blog 审稿日')
    expect(buildTodoEmail(5, EMPTY, 'x').html).toContain('收尾日')
  })
})

describe('nzWeekday', () => {
  it('maps a known UTC instant to the NZ weekday', () => {
    // 2026-07-30 19:05 UTC = Friday 07:05 NZST (UTC+12)
    expect(nzWeekday(new Date('2026-07-30T19:05:00Z'))).toBe(5)
    // 2026-08-01 19:05 UTC = Sunday morning NZ → weekend guard fires
    expect(nzWeekday(new Date('2026-08-01T19:05:00Z'))).toBe(0)
  })
})

/**
 * 🔴 人工待办的正文里**有客人自己写的字** —— `dm_maybe_stop` 会把 Facebook
 * 私信原话摘一段进 `what`，联系人姓名也是客人自己填的。
 *
 * 不转义的话，任何一个陌生人只要在私信里发一段带标记的话，就能往**我们自己
 * 发出去的官方日报**里注入链接 / 图片 —— 收件人是 PM 和 FDE，那封邮件看起来
 * 完全可信。（Codex 复审 PR #1037，2026-08-17）
 */
describe('buildTodoEmail · 人工待办正文要转义', () => {
  const evil = (over: Partial<TodoCounts['manualItems'][number]> = {}) => ({
    kind: 'dm_maybe_stop' as const,
    client_id: 'c1',
    client_name: 'CTS',
    what: '客人说了「do not follow up <a href="https://evil.example">点我领奖</a>」',
    how: '看一眼',
    href: 'https://app.magicengine.com.au/dashboard/clients/c1/crm/all?contact=p1',
    ...over,
  })

  it('what 里的标记被转义，不会变成真链接', () => {
    const html = buildTodoEmail(3, { ...EMPTY, manualItems: [evil()] }, 'x').html
    expect(html).not.toContain('<a href="https://evil.example"')
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;')
  })

  it('how 和客户名一样要转义', () => {
    const html = buildTodoEmail(
      3,
      { ...EMPTY, manualItems: [evil({ how: '<script>x</script>', client_name: '<b>x</b>' })] },
      'x',
    ).html
    expect(html).not.toContain('<script>x</script>')
    expect(html).not.toContain('<b>x</b>：')
  })

  it('href 当属性值转义 —— 引号闭合不了才注不进新属性', () => {
    const html = buildTodoEmail(
      3,
      { ...EMPTY, manualItems: [evil({ href: 'https://x.test/" onmouseover="alert(1)' })] },
      'x',
    ).html
    expect(html).not.toContain('onmouseover="alert(1)"')
  })

  it('正常条目的样子不变（现有条目正文都是纯文字）', () => {
    const html = buildTodoEmail(
      3,
      { ...EMPTY, manualItems: [evil({ what: '出片余额用完了', how: '去充值' })] },
      'x',
    ).html
    expect(html).toContain('出片余额用完了')
    expect(html).toContain('去充值')
  })
})
