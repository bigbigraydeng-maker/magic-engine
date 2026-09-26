/**
 * 批准 / 驳回必须绑定「人在页面上看到的那份审批请求」—— 走 `approveAndRun` /
 * `rejectPendingRun` 这条会**真的执行**的路径时也一样。
 *
 * 事故形状（子牙 2026-09-26）：`approveAndRun` 早先不收 options，
 * `expectedDecisionId` 恒为 undefined → `approveRun` 退回「服务端重读当前那份」。
 *   10:00 人打开页面，看到审批请求 A
 *   10:05 run 被重新挂到审批请求 B 上（政策变了 / 重排了）
 *   10:06 人点「批准」—— 批的是 B，而且立刻执行
 *
 * 这里用真 Kernel + 假库把「重挂到 B」造出来，断言：带着 A 去批，
 * 在**任何写入之前**失败 —— 决策表一行不多、run 仍在等人点头、capability 一次没调。
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction, approveAndRun, rejectPendingRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { KernelError } from '../errors'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
// 夹具 BLOG_DRAFT 声明为通用 Row；它就是 fixtures.ts 往 blog_posts 表里放的那一行，
// 跟 human-approval.test.ts:23 同一种写法（已跑通），capability 读的也是这一行。
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const APPROVAL_POLICY = { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 0 }
const DECISION_B = '99999999-8888-4777-8666-555555555555'

async function pendingFixture() {
  const calls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: Object.fromEntries(
            Object.entries(impl.steps).map(([k, h]) => [
              k,
              async (s: Parameters<typeof h>[0]) => {
                calls()
                return h(s)
              },
            ]),
          ),
        },
      }
    },
    options: { policy: APPROVAL_POLICY },
  })
  const pending = await runAction(f.kernel, {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth',
    goalId: GOAL_A,
    triggeredBy: 'schedule',
    input: { blog_post_id: POST_A, content_hash: HASH },
  })
  expect(pending.kind).toBe('pending_approval')
  const decisionA = pending.run.authorization_decision_id as string
  expect(decisionA).toBeTruthy()
  return { f, runId: pending.run.id, decisionA, calls }
}

type F = Awaited<ReturnType<typeof pendingFixture>>['f']

/** 把 run 重新挂到一份新的审批请求 B 上（身份字段全对得上，只有 id 不同）。 */
function repointToDecisionB(f: F, runId: string, decisionA: string) {
  const a = f.tables.authorization_decisions.find((d) => d.id === decisionA)!
  f.tables.authorization_decisions.push({ ...a, id: DECISION_B })
  const run = f.tables.action_runs.find((r) => r.id === runId)!
  run.authorization_decision_id = DECISION_B
}

function snapshot(f: F, runId: string) {
  return {
    decisions: f.tables.authorization_decisions.length,
    status: f.tables.action_runs.find((r) => r.id === runId)!.status,
  }
}

describe('🔴 approveAndRun 批的必须是人看到的那一份', () => {
  it('人看到 A、期间重挂成 B、带着 A 点批准 → STALE_DECISION，一个字都没写、什么都没执行', async () => {
    const { f, runId, decisionA, calls } = await pendingFixture()
    repointToDecisionB(f, runId, decisionA)
    const before = snapshot(f, runId)

    const err = await approveAndRun(f.kernel, runId, 'ray@magiclab', { expectedDecisionId: decisionA }).catch((e) => e)

    expect(err).toBeInstanceOf(KernelError)
    expect((err as KernelError).code).toBe('STALE_DECISION')
    expect(snapshot(f, runId)).toEqual(before)
    expect(before.status).toBe('pending_approval')
    expect(calls).not.toHaveBeenCalled()
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('刷新后看到的是 B、带着 B 点批准 → 正常批准并真的跑完', async () => {
    const { f, runId, decisionA, calls } = await pendingFixture()
    repointToDecisionB(f, runId, decisionA)

    const out = await approveAndRun(f.kernel, runId, 'ray@magiclab', { expectedDecisionId: DECISION_B })

    expect(out.kind).toBe('succeeded')
    expect(calls).toHaveBeenCalled()
    expect(f.tables.authorization_decisions.at(-1)!.verdict).toBe('allow')
  })

  it('没变过、带着 A 点批准 → 正常批准（不是一律拒）', async () => {
    const { f, runId, decisionA } = await pendingFixture()
    const out = await approveAndRun(f.kernel, runId, 'ray@magiclab', { expectedDecisionId: decisionA })
    expect(out.kind).toBe('succeeded')
  })
})

describe('🔴 rejectPendingRun 拒的也必须是人看到的那一份', () => {
  it('人看到 A、期间重挂成 B、带着 A 点驳回 → STALE_DECISION，一个字都没写', async () => {
    const { f, runId, decisionA, calls } = await pendingFixture()
    repointToDecisionB(f, runId, decisionA)
    const before = snapshot(f, runId)

    const err = await rejectPendingRun(f.kernel, runId, 'ray@magiclab', '不做', { expectedDecisionId: decisionA })
      .catch((e) => e)

    expect((err as KernelError).code).toBe('STALE_DECISION')
    expect(snapshot(f, runId)).toEqual(before)
    expect(calls).not.toHaveBeenCalled()
  })

  it('带着当前那份点驳回 → 正常驳回', async () => {
    const { f, runId, decisionA } = await pendingFixture()
    repointToDecisionB(f, runId, decisionA)
    const out = await rejectPendingRun(f.kernel, runId, 'ray@magiclab', '不做', { expectedDecisionId: DECISION_B })
    expect(out.kind).toBe('denied')
    expect(out.run.status).toBe('denied')
  })
})
