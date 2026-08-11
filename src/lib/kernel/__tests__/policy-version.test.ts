/**
 * P1-3 —— 政策版本由数据库强制演进，不靠「改一次记得 +1」。
 *
 * Gateway 的 stale-policy 防护完全建立在「政策一变，policy_version 就变」上。
 * 如果这只是 migration 注释里的一句约定，那么将来任何一个忘了 bump 的写入方
 * （设置页、修数据的脚本、API）都会让「客户刚把自动改成禁止」这件事
 * 对已签发的授权**完全没有效果** —— 而那正是这套机制唯一要防的场景。
 *
 * 所以这一组全部**不手动改 policy_version**，只改业务字段，
 * 然后断言版本自己变了、旧授权自己失效了。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, liveFence } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 }

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

/** 拿到一份已签发的 allow 授权，且此刻还没开跑。 */
async function authorizedFixture() {
  const builds = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            ...impl.steps,
            build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
              builds()
              return impl.steps.build(s)
            },
          },
        },
      }
    },
    options: { policy: AUTO_POLICY },
  })
  const { run } = await submitActionRun(f.kernel, submit())
  const auth = await authorizeRun(f.kernel, run)
  expect(auth.verdict).toBe('allow')
  expect(f.tables.authorization_decisions[0].policy_version).toBe(1)
  return { f, auth, builds }
}

/** 只改业务字段，**故意不碰 policy_version**。 */
async function patchPolicy(
  f: Awaited<ReturnType<typeof authorizedFixture>>['f'],
  patch: Record<string, unknown>,
) {
  const r = await f.supabase
    .from('client_automation_policies')
    .update(patch)
    .eq('id', 'policy-1')
    .select('id')
  expect(r.error).toBeNull()
}

describe('P1-3 · 政策版本自动演进', () => {
  it('🔴 只把「自动」改成「禁止」，不手动改版本 → 版本自己变 2，旧授权立即失效', async () => {
    const { f, auth, builds } = await authorizedFixture()

    await patchPolicy(f, { mode: 'deny' })

    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/规则.*改过/)
    expect(builds).not.toHaveBeenCalled()
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('改花钱上限 → 版本自己 +1，旧授权失效', async () => {
    const { f, auth, builds } = await authorizedFixture()
    await patchPolicy(f, { spend_cap_per_run_usd: 25 })
    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/规则.*改过/)
    expect(builds).not.toHaveBeenCalled()
  })

  it('改授权有效期 → 版本自己 +1，旧授权失效', async () => {
    const { f, auth } = await authorizedFixture()
    await patchPolicy(f, { decision_ttl_seconds: 60 })
    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/规则.*改过/)
  })

  it('改生效窗口 → 版本自己 +1', async () => {
    const { f } = await authorizedFixture()
    await patchPolicy(f, { effective_from: '2026-01-01T00:00:00.000Z' })
    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)
  })

  it('只改跟授权无关的字段（谁改的）→ 版本不动，已签发的授权照常有效', async () => {
    const { f, auth, builds } = await authorizedFixture()
    await patchPolicy(f, { updated_by: 'someone-else@magiclab' })

    expect(f.tables.client_automation_policies[0].policy_version).toBe(1)
    const result = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))
    expect(result.status).toBe('succeeded')
    expect(builds).toHaveBeenCalledTimes(1)
  })

  it('🔴 调用方自己传 policy_version 不算数 —— 版本归数据库管', async () => {
    const { f, auth } = await authorizedFixture()

    // 有人想「改了模式但把版本按回去」，好让旧授权继续有效
    await patchPolicy(f, { mode: 'deny', policy_version: 1 })

    expect(f.tables.client_automation_policies[0].policy_version).toBe(2)
    await expect(executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))).rejects.toThrow(/规则.*改过/)
  })

  it('🔴 什么都没改时也不许手工把版本推高（防止有人靠改号码批量作废授权）', async () => {
    const { f, auth } = await authorizedFixture()
    await patchPolicy(f, { policy_version: 99 })
    expect(f.tables.client_automation_policies[0].policy_version).toBe(1)
    const result = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))
    expect(result.status).toBe('succeeded')
  })

  it('政策的身份字段（客户 / 动作）不许原地改', async () => {
    const { f } = await authorizedFixture()
    const r = await f.supabase
      .from('client_automation_policies')
      .update({ action_key: 'something.else' })
      .eq('id', 'policy-1')
      .select('id')
    expect(r.error?.message).toMatch(/immutable/)
    expect(f.tables.client_automation_policies[0].action_key).toBe(KEY)
  })

  it('端到端：改成禁止之后再提交同类新动作 → 直接被拒，不是「先跑再说」', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    await f.supabase
      .from('client_automation_policies')
      .update({ mode: 'deny' })
      .eq('id', 'policy-1')
      .select('id')

    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('policy_deny')
    expect(f.tables.production_packages).toHaveLength(0)
  })
})
