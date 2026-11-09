/**
 * 今日待办只留五类（PM 2026-09-26）—— 车道表、合并规则、以及拿 2026-09-25 那封
 * 「166 件」重建出来的验收。
 */

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildTodoEmail,
  buildTodoView,
  collapseManualItems,
  commonHref,
  type TodoCounts,
} from '../daily-todo'
import { LANE_OF_KIND, PM_KIND_ORDER, blindSpotNotes, laneOf, type TodoLane } from '../five-kinds'
import type { ManualItem } from '../manual-item-types'
import { AFTER, BEFORE, legacyTotal } from './fixtures/todo-2026-09-25'

const EMPTY: TodoCounts = {
  setupTasks: [],
  draftsByClient: [],
  findingsByClient: [],
  recentCardsByClient: [],
  reelsByClient: [],
  manualItems: [],
  cronFailures24h: 0,
}

const item = (over: Partial<ManualItem> = {}): ManualItem => ({
  kind: 'meta_stuck',
  client_id: 'c1',
  client_name: 'CTS Tours NZ',
  what: '一件事',
  how: '这么做',
  href: 'https://app.magicengine.com.au/dashboard/clients/c1/settings',
  ...over,
})

describe('车道表', () => {
  it('每一种待办都分到了七条车道之一', () => {
    const valid = new Set<TodoLane>([...PM_KIND_ORDER, 'dev', 'weekly'])
    for (const lane of Object.values(LANE_OF_KIND)) expect(valid.has(lane)).toBe(true)
  })

  it('🔴 条目自带的 pm_kind 只能在五类之间换，挪不出 PM 的清单，也不能把开发的活塞回来', () => {
    expect(laneOf(item({ kind: 'client_doc_manual_task', pm_kind: 'decide' }))).toBe('decide')
    expect(laneOf(item({ kind: 'client_doc_manual_task' }))).toBe('one_click')
    // 默认是开发 / 周报的，写了 pm_kind 也不动
    expect(laneOf(item({ kind: 'cron_failing', pm_kind: 'decide' }))).toBe('dev')
    expect(laneOf(item({ kind: 'diagnostic_findings', pm_kind: 'review' }))).toBe('weekly')
  })

  it('一个名字下两种活的，拆开后各走各的', () => {
    expect(LANE_OF_KIND.email_sync_stale).toBe('one_click')
    expect(LANE_OF_KIND.email_sync_broken).toBe('dev')
    expect(LANE_OF_KIND.creatomate_render_failed).toBe('one_click')
    expect(LANE_OF_KIND.creatomate_render_error).toBe('dev')
    expect(LANE_OF_KIND.lead_sheet_reauth_needed).toBe('one_click')
    expect(LANE_OF_KIND.lead_sheet_sync_failed).toBe('client_side')
    expect(LANE_OF_KIND.lead_sheet_check_failed).toBe('dev')
    expect(LANE_OF_KIND.conversation_health_alert).toBe('truth')
    expect(LANE_OF_KIND.conversation_health_check_error).toBe('dev')
    expect(LANE_OF_KIND.blog_draft_waiting).toBe('review')
    expect(LANE_OF_KIND.blog_publish_channel_broken).toBe('one_click')
  })

  it('🔴 人工待办整个读挂了：不许写「无事」，标题和正文都说有检查没跑成', () => {
    const email = buildTodoEmail(3, { ...EMPTY, manualItems: [item({ kind: 'todo_items_unreadable', href: '' })] }, 'x')
    expect(email.subject).toContain('有检查没跑成')
    expect(email.subject).not.toContain('无事')
    expect(email.html).toContain('人工待办今天整个没读出来')
    expect(email.html).not.toContain('没有要你做的事。')
  })

  it('开发欠账里会让 PM 某一栏变成「假的没有」的，要在清单顶上说「今天没查成」', () => {
    expect(blindSpotNotes([item({ kind: 'email_sync_broken' })])).toHaveLength(1)
    expect(blindSpotNotes([item({ kind: 'cron_failing' })])).toEqual([])
    const email = buildTodoEmail(3, { ...EMPTY, manualItems: [item({ kind: 'email_sync_broken' })] }, 'x')
    expect(email.html).toContain('今天没查成')
    expect(email.html).toContain('客人来信没回')
    expect(email.totalItems).toBe(0)
  })
})

describe('合并同一件事', () => {
  it('同一客户、同一做法、同一页面的 N 条合成一行，链接只留大家都一样的参数', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      item({
        kind: 'conversion_needs_review',
        what: `客人 ${i} 来问过`,
        href: `https://app.magicengine.com.au/dashboard/conversions?client=c1&focus=o${i}`,
      }),
    )
    const view = buildTodoView({ ...EMPTY, manualItems: rows })
    expect(view.totalItems).toBe(1)
    const row = view.sections[0].rows[0]
    expect(row.pm_kind).toBe('decide')
    expect(row.count).toBe(20)
    expect(row.what).toContain('共 20 条同类')
    expect(row.samples).toHaveLength(3)
    expect(row.href).toBe('https://app.magicengine.com.au/dashboard/conversions?client=c1')
  })

  it('落地页面不同的不合（合了链接只能指到其中一个）', () => {
    const out = collapseManualItems([
      item({ href: 'https://app.magicengine.com.au/a' }),
      item({ href: 'https://app.magicengine.com.au/b' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('做法不同 / 客户不同的不合', () => {
    expect(collapseManualItems([item(), item({ how: '别的做法' })])).toHaveLength(2)
    expect(collapseManualItems([item(), item({ client_id: 'c2' })])).toHaveLength(2)
  })

  it('🔴 「认真假」那一栏一条都不合：两件串台是两件事', () => {
    const leak = (pair: string) =>
      item({ kind: 'cross_client_leak', client_id: 'infra', client_name: 'x', what: pair, how: '同一句话', href: 'https://app.magicengine.com.au/dashboard/clients' })
    const view = buildTodoView({ ...EMPTY, manualItems: [leak('Roman / CTS'), leak('Oztop / NAL')] })
    expect(view.totalItems).toBe(2)
  })

  it('commonHref：解析不了或路径不同就原样用第一条', () => {
    expect(commonHref(['not a url', 'also not'])).toBe('not a url')
    expect(commonHref(['https://x.test/a?k=1', 'https://x.test/b?k=1'])).toBe('https://x.test/a?k=1')
    expect(commonHref(['https://x.test/a?k=1&f=2', 'https://x.test/a?k=1&f=3'])).toBe('https://x.test/a?k=1')
  })

  it('草稿：人工待办里已经有这个客户的草稿那条，就不再按篇数另起一行', () => {
    const view = buildTodoView({
      ...EMPTY,
      draftsByClient: [{ name: 'CTS Tours NZ', id: 'c1', drafts: 2 }, { name: 'oztop', id: 'c2', drafts: 4 }],
      manualItems: [
        item({ kind: 'blog_draft_waiting', client_id: 'c1', href: 'https://app.magicengine.com.au/dashboard/clients/c1/blog' }),
        item({ kind: 'blog_publish_channel_broken', client_id: 'c2' }),
      ],
    })
    expect(view.totalItems).toBe(2)
    expect(view.sections.flatMap((s) => s.rows).some((r) => r.kind === 'blog_drafts')).toBe(false)
  })
})

describe('邮件和页面是同一份东西', () => {
  it('邮件的件数就是 view 的行数，每一行的 what 都出现在邮件里', () => {
    const view = buildTodoView(AFTER)
    const email = buildTodoEmail(5, AFTER, '25 Sept')
    expect(email.totalItems).toBe(view.totalItems)
    for (const row of view.sections.flatMap((s) => s.rows)) {
      const firstLine = row.what.slice(0, 20).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      expect(email.html).toContain(firstLine)
    }
  })
})

/**
 * 验收：2026-09-25 那封信按生产形状重建，旧口径 166 件，新口径只剩五类。
 * `PRINT_TODO_FIXTURE=1 npx vitest run …/five-kinds.test.ts` 会把前后对照表打出来（PR 里贴的就是它）。
 */
describe('验收 · 2026-09-25「166 件」', () => {
  it('旧口径重建出来正好是 166 件（夹具跟那封信对得上）', () => {
    expect(legacyTotal(BEFORE)).toBe(166)
  })

  it('新口径：只剩五类，每一类有几件', () => {
    const view = buildTodoView(AFTER)
    const byKind = Object.fromEntries(view.sections.map((s) => [s.pm_kind, s.rows.length]))
    // 2026-10-12：台账「验过不成」从拍板栏挪进开发欠账（PM：邮件只发机器完成不了的事）→ 拍板 4→3、开发 6→7
    expect(byKind).toEqual({ decide: 3, one_click: 8, client_side: 4, review: 4, truth: 5 })
    expect(view.totalItems).toBe(24)
    // 挪走的也都有去处：开发欠账清单 6 件（合并后）、周报 8 件、24 小时 70 次任务失败
    expect(view.routedToDev).toBe(7)
    expect(view.routedToWeekly).toBe(8)
    expect(view.cronFailures24h).toBe(70)

    const email = buildTodoEmail(5, AFTER, '25 Sept')
    expect(email.subject).toBe('📋 今日待办 · 周五 · 24 件')
    // 不该出现在每日待办里的东西
    for (const gone of ['SEO 巡逻', '本周新建议卡', '这周系统替你做了什么', 'Afterpay Team 发到公司邮箱', 'Big Ray Deng', '还有 23 封']) {
      expect(email.html).not.toContain(gone)
    }
    expect(email.html).toContain('7 件开发欠账')
    expect(email.html).toContain('8 件系统知会挪到周一周报')

    if (process.env.PRINT_TODO_FIXTURE) {
      const lines = view.sections.flatMap((s) =>
        s.rows.map((r) => `${s.pm_kind.padEnd(12)} ${r.client_name} · ${r.kind}${r.count > 1 ? ` ×${r.count}` : ''} · ${r.what.slice(0, 40)}`),
      )
      console.log(`BEFORE ${legacyTotal(BEFORE)} → AFTER ${view.totalItems}\n${lines.join('\n')}`)
      // 把渲染出来的邮件写成网页，给人亲眼看一遍（不发信）
      if (process.env.TODO_FIXTURE_HTML_OUT) {
        writeFileSync(process.env.TODO_FIXTURE_HTML_OUT, `<meta charset="utf-8"><title>${email.subject}</title>${email.html}`)
      }
    }
  })
})
