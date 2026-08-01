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
      href: 'https://app.magicengine.com.au/api/auth/google/gbp/start?clientId=cid-1',
    },
    {
      name: 'oztop',
      id: 'cid-2',
      label: '连接 Google 商家页（点一次授权，之后自动发帖）',
      href: 'https://app.magicengine.com.au/api/auth/google/gbp/start?clientId=cid-2',
    },
  ]

  it('renders one authorise link per client and counts into the total', () => {
    const email = buildTodoEmail(3, { ...EMPTY, setupTasks: SETUP }, '1 Aug')

    expect(email.totalItems).toBe(2)
    expect(email.subject).toContain('2 件')
    expect(email.html).toContain('去连接')
    expect(email.html).toContain('gbp/start?clientId=cid-1')
    expect(email.html).toContain('gbp/start?clientId=cid-2')
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
    expect(tasks[0].href).toContain('gbp/start?clientId=cts')
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
    expect(tasks[0].href).toContain('gbp/start')
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

    expect(email.totalItems).toBe(17)
    expect(email.subject).toContain('17 件')
    expect(email.html).toContain('/clients/cid-1/blog')
    expect(email.html).toContain('/clients/cid-2/execution')
    expect(email.html).toContain('Blog 草稿待审')
    expect(email.html).toContain('SEO 巡逻新发现')
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
