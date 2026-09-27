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
    const draftsAt = email.html.indexOf('Blog 草稿待审')
    expect(setupAt).toBeGreaterThan(-1)
    expect(draftsAt).toBeGreaterThan(-1)
    expect(setupAt).toBeLessThan(draftsAt)
    expect(email.totalItems).toBe(4)
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

  it('drafts + findings show per-client rows with deep links and sum into the subject', () => {
    const email = buildTodoEmail(1, {
      ...EMPTY,
      draftsByClient: [
        { name: 'CTS Tours NZ', id: 'cid-1', drafts: 7 },
        { name: 'oztop', id: 'cid-2', drafts: 7 },
      ],
      findingsByClient: [{ name: 'oztop', id: 'cid-2', findings: 3 }],
    }, '31 Jul')

    // 🔴 14 = 7 + 7 草稿。**巡逻发现那 3 条不进总数** ——
    //    它们当天就被自动排成了建议卡，跟建议卡是同一批活儿，
    //    两边各数一遍就是虚高。PM 2026-08-04 收到「91 件」正是这么堆出来的。
    expect(email.totalItems).toBe(14)
    expect(email.subject).toContain('14 件')
    expect(email.html).toContain('/clients/cid-1/blog')
    expect(email.html).toContain('/clients/cid-2/execution')
    expect(email.html).toContain('Blog 草稿待审')
    // 发现仍然显示（要看得见系统查到了什么），只是措辞说清它不用单独处理
    expect(email.html).toContain('SEO 巡逻查到的')
    expect(email.html).toContain('不用单独处理')
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
   * 都是「回我一句我去改」，PM 没法真的动手，塞进「🙋 需要你动手」栏是把
   * dev 的活假装成 PM 的活。这条测试锁死：它们进单独一栏「🛠 系统欠账」，
   * 不进「🙋 需要你动手」，不进「📣 系统替你做了什么」，不抬高总数。
   */
  it.each([
    'auto_run_stuck',
    'action_unattributable',
    'attribution_audit_failed',
    'client_list_unreadable',
    'cron_blind',
    'ads_config_unreadable',
  ] as const)('🛠 %s 走「系统欠账」栏，不进「需要你动手」，不抬高总数', (kind) => {
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
    expect(email.html).toContain('系统欠账')
    expect(email.html).not.toContain('需要你动手')
    // 这些不是"系统替你做了什么"（那是给成功事件用的），也不属于那栏
    const infoAt = email.html.indexOf('这周系统替你做了什么')
    expect(infoAt).toBe(-1)
    expect(email.totalItems).toBe(0)
    expect(email.subject).toContain('无事')
  })

  it('🛠 系统欠账栏与「需要你动手」栏共存时，只有 action 类算进总数', () => {
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
    expect(email.html).toContain('需要你动手')
    expect(email.html).toContain('系统欠账')
    // 只有 video_credits_out 算一件
    expect(email.totalItems).toBe(1)
    expect(email.subject).toContain('1 件')
  })

  /**
   * 2026-09-07 铁律 3 下半（PR #1442）：`diagnostic_findings` 走「系统替你
   * 做了什么」栏，见 daily-todo.ts:29 INFORMATIONAL_KINDS 头注。此条测试
   * 保护那份契约，跟上面 dev-owned 契约互不重叠。
   */
  it('🔴 本周体检查到的严重问题走「系统替你做了什么」栏，不进「需要你动手」，不抬高总数', () => {
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
    // 不进「需要你动手」，走「系统替你做了什么」
    expect(email.html).not.toContain('需要你动手')
    expect(email.html).toContain('系统替你做了什么')
    expect(email.html).toContain('CTS Tours NZ')
    // 不抬高总数
    expect(email.totalItems).toBe(0)
    expect(email.subject).toContain('无事')
  })

  it('zero-count sections are omitted entirely', () => {
    const email = buildTodoEmail(3, {
      ...EMPTY,
      cronFailures24h: 2,
    }, '31 Jul')
    expect(email.html).not.toContain('Blog 草稿待审')
    expect(email.html).toContain('系统有活儿没跑成')
    expect(email.totalItems).toBe(2)
  })

  it('reels awaiting review show as 社媒成片待审 with factory link', () => {
    const email = buildTodoEmail(4, {
      ...EMPTY,
      reelsByClient: [{ name: 'CTS Tours NZ', id: 'cid-1', reels: 11 }],
    }, '1 Aug')
    expect(email.totalItems).toBe(11)
    expect(email.html).toContain('社媒成片待审')
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
