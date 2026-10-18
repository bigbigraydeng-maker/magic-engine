/**
 * 「有专属审批入口的动作」登记表 + 通用 handoff 的排除。
 *
 * 🔴 两件事：
 *   ① 登记表不许登记假入口（动作不存在 / 页面文件不存在 / 重复登记）；
 *   ② 通用 handoff 对登记过的动作**只**排除 pending_approval，而且排除发生在
 *      查询层 —— 查出来再滤的话，登记动作的等批准会占满 50 条名额，
 *      把别的动作的死信静默挤掉（魏征 2026-09-26）。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DEDICATED_APPROVAL_ENTRIES,
  dedicatedApprovalActionKeys,
  dedicatedApprovalEntryFor,
} from '../dedicated-approval-entries'
import { ACTION_REGISTRY } from '../registry'
import { fetchKernelHandoffTodos } from '../handoff'
import { createFakeSupabase, type Row } from './fake-supabase'

const ROOT = join(__dirname, '..', '..', '..', '..')
const NOW = new Date('2026-09-26T09:00:00.000Z')
const D3 = 'ads.auto_pause_on_d3'
// 🔴 「别的动作」必须是一个断言**不在**登记表里的键 —— 别人往表里加 SEO 那一行时，
//    这里不能跟着悄悄变成「登记动作」而让测试失去意义。
const OTHER = 'seo.build_publish_package'

/**
 * `/dashboard/clients/<id>/…` → `src/app/dashboard/clients/[id]/…/page.tsx`
 *
 * 🔴 先砍掉 `?query`（2026-10-18）：入口搬进广告门的标签之后，登记的路径带了
 * `?tab=approvals`。页面是问号**前面**那一段，带着 query 去拼文件名会拼出
 * `ads-health?tab=approvals/page.tsx` 这种不存在的路径，把这道守卫搞红。
 * 守卫要守的是「登记的入口有真实页面」，不是「路径里不许有 query」。
 */
function pageFileFor(path: string): string {
  const withoutQuery = path.split('?')[0]
  const routed = withoutQuery.replace(/^\/dashboard\/clients\/[^/]+\//, 'dashboard/clients/[id]/')
  return join(ROOT, 'src', 'app', routed.replace(/^\//, ''), 'page.tsx')
}

describe('登记表守卫：不许登记假入口', () => {
  it('至少登记了广告自动暂停', () => {
    expect(dedicatedApprovalEntryFor(D3)?.label).toBe('广告门 ·「等你点头」')
  })

  it.each(DEDICATED_APPROVAL_ENTRIES.map((e) => [e.actionKey, e]))('%s 在动作注册表里', (_k, e) => {
    expect(ACTION_REGISTRY.get(e.actionKey)).not.toBeNull()
  })

  it.each(DEDICATED_APPROVAL_ENTRIES.map((e) => [e.actionKey, e]))('%s 的入口页面文件真实存在', (_k, e) => {
    const file = pageFileFor(e.path('c0000000-0000-0000-0000-000000000000'))
    expect(existsSync(file), `登记的入口 ${e.path('x')} 找不到页面文件 ${file}`).toBe(true)
  })

  it('动作键只许字母 / 数字 / 点 / 下划线 —— 它会被拼进查询的 .or() 里，带引号或括号就会把查询拼坏', () => {
    for (const key of dedicatedApprovalActionKeys()) expect(key).toMatch(/^[a-z0-9_.]+$/)
  })

  it('没有重复登记', () => {
    const keys = dedicatedApprovalActionKeys()
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('「别的动作」这个测试用键确实不在登记表里', () => {
    expect(dedicatedApprovalEntryFor(OTHER)).toBeNull()
  })
})

let seq = 0
function run(actionKey: string, status: string, minutesAgo: number): Row {
  seq += 1
  return {
    id: `run-${seq}`,
    client_id: 'client-1',
    action_key: actionKey,
    status,
    needs_human: true,
    last_error: status === 'pending_approval' ? null : '重试到上限',
    updated_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  }
}

function sbWith(rows: Row[]) {
  return createFakeSupabase({ action_runs: rows })
}

describe('通用 handoff：登记动作的等批准不再发通用待办', () => {
  it('🔴 60 条 D3 等批准（更新）+ 1 条别的动作死信（更老）→ 死信仍在，D3 一条都不出', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => run(D3, 'pending_approval', i + 1))
    const deadLetter = run(OTHER, 'dead_letter', 600)
    const todos = await fetchKernelHandoffTodos(sbWith([...rows, deadLetter]), NOW)

    expect(todos.map((t) => t.run_id)).toEqual([deadLetter.id])
  })

  it('D3 的死信 / 被拒仍走通用待办（专属待办只管等批准）', async () => {
    const dl = run(D3, 'dead_letter', 5)
    const denied = run(D3, 'denied', 6)
    const todos = await fetchKernelHandoffTodos(sbWith([dl, denied]), NOW)
    expect(todos.map((t) => t.run_id).sort()).toEqual([dl.id, denied.id].sort())
  })

  it('没登记的动作等批准 → 通用待办照发（原有行为不变）', async () => {
    const pending = run(OTHER, 'pending_approval', 5)
    const todos = await fetchKernelHandoffTodos(sbWith([pending]), NOW)
    expect(todos.map((t) => t.run_id)).toEqual([pending.id])
  })
})
