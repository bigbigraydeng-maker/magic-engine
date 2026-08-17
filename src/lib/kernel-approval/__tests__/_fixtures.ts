/**
 * K-WP01A 审批测试的共享夹具。
 *
 * 🔴 **只放夹具，不放断言。** 拆文件是为了让每份回归套件能被完整审查
 *    （CLAUDE.md：文件 < 800 行）—— 把断言也挪进来，只是把「读不完」
 *    换个地方藏，等于没拆。
 *
 * 🔴 这个文件名以 `_` 开头且不带 `.test.` —— vitest 不会把它当测试文件收，
 *    仓库的架构扫描也按 `/__tests__/` 判成测试代码（不受生产禁令约束）。
 */

import { expect } from 'vitest'
import { runAction } from '@/lib/kernel/runner'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from '@/lib/kernel/__tests__/fixtures'

export const KEY = 'seo.build_publish_package'
export const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
export const APPROVAL_POLICY = {
  action_key: KEY,
  mode: 'require_approval',
  spend_cap_per_run_usd: 0,
}
export const ACTOR = 'ray@magiclab'

export function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

/** 一条真的停在「等人点头」的 run（走完整 Kernel 提交链路，不是手塞一行）。 */
export async function pendingFixture(supabaseOptions: Record<string, unknown> = {}) {
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
    options: { policy: APPROVAL_POLICY, supabaseOptions },
  })
  const pending = await runAction(f.kernel, submit())
  expect(pending.kind).toBe('pending_approval')
  const run = f.tables.action_runs[0]
  return { f, runId: String(run.id), expectedDecisionId: String(run.authorization_decision_id) }
}

/** 第 i 条种子 run 的 id。**合法 UUID** —— 真表里这一列就是 uuid。 */
export const seededRunId = (i: number): string =>
  `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`

/** 第 i 条种子决策的 id。 */
export const seededDecisionId = (i: number): string =>
  `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`
