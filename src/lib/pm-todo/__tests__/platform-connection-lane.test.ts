/**
 * 断线待办**落在哪一栏**的回归测试。
 *
 * 分栏错了不会有任何报错，但后果很具体：
 *  · 该 PM 动手的被当成开发欠账 → 那件只有邮箱本人能做的事从他的清单上消失，
 *    也不计进「今天有几件事」，于是**没人会去重连** —— 正是 9 天事故的重演。
 *  · PM 做不了的落进「系统进不去、要你点一次的」→ 每天给他一件点了也没用的活，
 *    栏目一被稀释，真正等他动手的那条会被一起划过去。
 *
 * 所以这两个方向都钉死，直接看**渲染出来的邮件**——测行为，不测存在。
 * 2026-09-26 起开发欠账不再在 PM 邮件里占一栏，只剩一行「N 件开发欠账」+ 清单链接。
 */

import { describe, expect, it } from 'vitest'
import { buildTodoEmail, type TodoCounts } from '../daily-todo'
import { LANE_OF_KIND } from '../five-kinds'
import { DEV_LANE_CONNECTION_KINDS, type PlatformConnectionItemKind } from '../platform-connection-items'
import type { ManualItem } from '../manual-item-types'

const ACTION_SECTION = '系统进不去、要你点一次的'

const ALL_KINDS: PlatformConnectionItemKind[] = [
  'platform_connection_broken',
  'platform_connection_token_expired',
  'platform_connection_silent',
  'platform_connection_scope_gap',
  'platform_connection_pipeline_down',
  'platform_connection_not_enrolled',
  'platform_connection_no_reconnect_ui',
  'platform_connection_orphan',
  'platform_connection_check_failed',
]

function emailWith(kind: PlatformConnectionItemKind) {
  const item: ManualItem = {
    kind,
    client_id: 'client-1',
    client_name: 'CTS Tours NZ',
    what: `这是 ${kind} 的内容`,
    how: '这是怎么做',
    href: '',
  }
  const counts: TodoCounts = {
    setupTasks: [],
    draftsByClient: [],
    findingsByClient: [],
    recentCardsByClient: [],
    reelsByClient: [],
    manualItems: [item],
    cronFailures24h: 0,
  }
  return buildTodoEmail(1, counts, '9月24日')
}

describe('断线待办的分栏', () => {
  it.each(ALL_KINDS)('%s 落在正确的地方，且计不计数也对', (kind) => {
    const { html, totalItems } = emailWith(kind)
    const isDev = DEV_LANE_CONNECTION_KINDS.includes(kind)
    if (isDev) {
      // 开发的活：PM 邮件里看不到正文，也不算他的事，只剩一行「开发欠账」+ 链接
      expect(html).not.toContain(`这是 ${kind} 的内容`)
      expect(html).toContain('1 件开发欠账')
      expect(html).toContain('/dashboard/admin/cron-health#dev-debt')
      expect(totalItems).toBe(0)
    } else {
      const at = html.indexOf(`这是 ${kind} 的内容`)
      expect(at).toBeGreaterThan(html.indexOf(ACTION_SECTION))
      expect(html.indexOf(ACTION_SECTION)).toBeGreaterThan(-1)
      expect(totalItems).toBe(1)
    }
  })

  it('DEV_LANE_CONNECTION_KINDS 跟车道表（five-kinds.ts）说的是同一件事', () => {
    for (const kind of ALL_KINDS) {
      expect(LANE_OF_KIND[kind] === 'dev').toBe(DEV_LANE_CONNECTION_KINDS.includes(kind))
    }
  })

  it('🔴 需要人去点一次同意页的那四条，一条都不许滑进 dev 栏', () => {
    // 这四条的共同点：只有邮箱本人 / 客户老板能做，系统永远做不了。
    for (const kind of [
      'platform_connection_broken',
      'platform_connection_token_expired',
      'platform_connection_silent',
      'platform_connection_scope_gap',
    ] as PlatformConnectionItemKind[]) {
      expect(DEV_LANE_CONNECTION_KINDS).not.toContain(kind)
    }
  })
})
