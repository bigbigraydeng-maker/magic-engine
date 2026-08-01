/**
 * Unit tests for the pure email-building logic in daily-todo.ts.
 * (loadTodoCounts is a thin Supabase read verified at integration time.)
 */

import { describe, it, expect } from 'vitest'
import { buildTodoEmail, nzWeekday, type TodoCounts } from '../daily-todo'

const EMPTY: TodoCounts = {
  draftsByClient: [],
  findingsByClient: [],
  recentCardsByClient: [],
  reelsByClient: [],
  cronFailures24h: 0,
}

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
