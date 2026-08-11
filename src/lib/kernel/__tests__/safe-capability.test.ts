/**
 * Kernel v1 的纵向切片 —— `seo.build_publish_package` 真的跑一遍。
 *
 * ADR-004 的原话：v1 必须执行一个**内部、可回滚、无外部副作用**的 capability，
 * **不能用纯 no-op 测试冒充执行闭环**。所以这一组测的是真事：
 *
 *   Goal → Action → Authorization → Running → Execute → Verify → Succeeded
 *
 * 每一步都断言库里**真的多了/改了东西**，而不是断言函数返回了什么。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { loadActionLineage } from '../lineage'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash, KERNEL_PRODUCER } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import {
  makeFixture,
  CLIENT_A,
  CLIENT_B,
  GOAL_A,
  BRIEF_A,
  POST_A,
  BLOG_DRAFT,
  liveFence,
} from './fixtures'

const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const AUTO_POLICY = {
  action_key: 'seo.build_publish_package',
  mode: 'auto_approve',
  spend_cap_per_run_usd: 0,
}

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: 'seo.build_publish_package',
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    triggeredByRef: 'weekly-blog-cron',
    rationale: '这篇稿子过了初审，先固化成一个可发布包，等人点发布',
    evidence: { source: 'seo-patrol', finding: 'thin-coverage:school-zone' },
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Safe capability：完整闭环真的跑通', () => {
  it('Goal → 授权 → 执行 → 验证 → 成功，且库里真的多了一个发布包', async () => {
    // 🔴 全程零对外 HTTP 写：把 fetch 打桩，跑完断言它一次都没被调用。
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('测试期间不允许发出任何网络请求')
    })

    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())

    // ── 执行状态 ──────────────────────────────────────────────────────────
    expect(outcome.kind).toBe('succeeded')
    expect(outcome.run.status).toBe('succeeded')
    expect(outcome.run.started_at).toBeTruthy()
    expect(outcome.run.finished_at).toBeTruthy()
    expect(outcome.run.needs_human).toBe(false)

    // ── 三个步骤全部真的跑过 ──────────────────────────────────────────────
    const steps = f.tables.action_run_steps
    expect(steps.map((s) => s.step_key)).toEqual(['build', 'persist', 'verify'])
    expect(steps.every((s) => s.status === 'succeeded')).toBe(true)
    expect(steps.every((s) => s.attempt === 1)).toBe(true)

    // ── 验证是真验证：七条断言全过 ────────────────────────────────────────
    const v = outcome.execution?.verification
    expect(v?.method).toBe('package_integrity')
    expect(v?.passed).toBe(true)
    expect(v?.checks.length).toBeGreaterThanOrEqual(7)
    expect(v?.checks.every((c) => c.passed)).toBe(true)

    // ── 库里真的多了一个包，而且停在内部草稿态 ────────────────────────────
    expect(f.tables.production_packages).toHaveLength(1)
    const pkg = f.tables.production_packages[0]
    expect(pkg.client_id).toBe(CLIENT_A)
    expect(pkg.master_brief_id).toBe(BRIEF_A)
    expect(pkg.dimension).toBe('seo')
    // 🔴 永远是 draft。后台首页的「待审」计数只数 ready_for_review，
    //    所以 Kernel 造的行不会混进 PM 的待审数字。
    expect(pkg.status).toBe('draft')
    const payload = pkg.source_payload as Record<string, unknown>
    expect(payload.produced_by).toBe(KERNEL_PRODUCER)
    expect(payload.kernel_run_id).toBe(outcome.run.id)
    expect(payload.content_hash).toBe(HASH)
    // 上下文快照真的带着正文，不是空对象
    expect(String((pkg.generation_context_snapshot as Record<string, unknown>).html_body)).toContain('学区')

    // ── 产物守契约 ────────────────────────────────────────────────────────
    expect(outcome.execution?.output?.package_id).toBe(pkg.id)
    expect(outcome.execution?.output?.content_hash).toBe(HASH)

    // ── 零对外副作用 ──────────────────────────────────────────────────────
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lineage 一路查得通：goal → run → 授权 → 步骤 → 验证', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const outcome = await runAction(f.kernel, submit())
    const lineage = await loadActionLineage(f.supabase, outcome.run.id)

    expect(lineage).toBeTruthy()
    expect(lineage!.goal?.id).toBe(GOAL_A)
    expect(lineage!.goal?.title).toBe('三个月内自然流量翻倍')
    expect(lineage!.run.rationale).toContain('过了初审')
    expect(lineage!.run.evidence).toMatchObject({ source: 'seo-patrol' })
    expect(lineage!.run.triggered_by).toBe('schedule')
    expect(lineage!.run.triggered_by_ref).toBe('weekly-blog-cron')
    expect(lineage!.authorization?.verdict).toBe('allow')
    expect(lineage!.authorization?.decided_by).toBe('policy')
    expect(lineage!.steps).toHaveLength(3)
    expect(lineage!.verification?.passed).toBe(true)
    expect(lineage!.humanSummary).toContain('验过了')
    expect(lineage!.humanSummary).toContain('3 步里做完 3 步')
  })

  it('同一篇稿子跑两次 → 只有一个包，第二次是幂等命中', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const first = await runAction(f.kernel, submit())
    const second = await runAction(f.kernel, submit())

    expect(first.kind).toBe('succeeded')
    expect(second.kind).toBe('idempotent_hit')
    expect(f.tables.production_packages).toHaveLength(1)
    expect(f.tables.action_runs).toHaveLength(1)
  })

  it('稿子改过之后再跑 → 那是另一件事，会再做一个包', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    await runAction(f.kernel, submit())

    // 编辑了正文 → 指纹变了
    f.tables.blog_posts[0].html_body = '<h2>学区</h2><p>改过的正文</p>'
    const newHash = computeBlogContentHash(f.tables.blog_posts[0] as unknown as BlogDraftRow)
    expect(newHash).not.toBe(HASH)

    const second = await runAction(f.kernel, {
      ...submit(),
      input: { blog_post_id: POST_A, content_hash: newHash },
    })

    expect(second.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(2)
  })
})

describe('Safe capability：该失败的时候真的失败', () => {
  it('排上之后稿子被人改过 → 停手，不拿一份对不上的内容做包', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const { run } = await submitActionRun(f.kernel, submit())
    // 授权之前有人动了稿子
    f.tables.blog_posts[0].title = '被人改过的标题'

    const auth = await authorizeRun(f.kernel, run)
    const result = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))

    expect(result.status).toBe('dead_letter')
    expect(String(result.failure?.humanReason)).toContain('又被改过了')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('稿子属于别的客户 → 查不到，停手（4 轴身份由服务端注入）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: AUTO_POLICY,
        blogPosts: [{ ...BLOG_DRAFT, client_id: CLIENT_B }],
      },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(String(outcome.humanReason)).toContain('找不到编号')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('客户没有品牌底稿 → 停手并说清缺什么', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY, masterBriefs: [] },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(String(outcome.humanReason)).toContain('品牌底稿')
  })

  it('已发布的稿子不再做包', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY, blogPosts: [{ ...BLOG_DRAFT, status: 'published' }] },
    })

    const outcome = await runAction(f.kernel, {
      ...submit(),
      input: {
        blog_post_id: POST_A,
        content_hash: computeBlogContentHash({ ...BLOG_DRAFT, status: 'published' } as unknown as BlogDraftRow),
      },
    })

    expect(outcome.kind).toBe('dead_letter')
    expect(String(outcome.humanReason)).toContain('不是能做发布包的状态')
  })

  it('🔴 上一次崩在半路留下了一行内容对不上的包 → 验证抓得出来，不算成功', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })

    const { run } = await submitActionRun(f.kernel, submit())
    // 模拟：上一次尝试写进去了一行，但内容指纹是旧的（写到一半就崩了）
    f.tables.production_packages.push({
      id: 'pkg-stale',
      client_id: CLIENT_A,
      master_brief_id: BRIEF_A,
      dimension: 'seo',
      title: '半成品',
      status: 'draft',
      source_payload: { produced_by: KERNEL_PRODUCER, kernel_run_id: run.id, content_hash: 'stale-hash' },
      generation_context_snapshot: {},
      created_at: '2026-08-08T00:00:00.000Z',
      updated_at: '2026-08-08T00:00:00.000Z',
    })

    const auth = await authorizeRun(f.kernel, run)
    const result = await executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f))

    expect(result.status).toBe('dead_letter')
    expect(result.failure?.code).toBe('VERIFICATION_FAILED')
    expect(String(result.failure?.humanReason)).toContain('内容指纹一致')
    // 验证不过 → 不重试（重试改变不了「写进去的跟该写的对不上」）
    const verifyStep = f.tables.action_run_steps.find((s) => s.step_key === 'verify')
    expect(verifyStep?.status).toBe('dead_letter')
    expect(verifyStep?.attempt).toBe(1)
  })

  it('读库炸了 → 当可重试处理，不当成「这条稿子不存在」', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: {
        policy: AUTO_POLICY,
        supabaseOptions: {
          failOn: [{ table: 'blog_posts', op: 'select', message: 'connection reset' }],
        },
      },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    // 🔴 判据是「重试了三次」：说明它被当成了可恢复的故障，
    //    而不是被当成「这个客户名下没有这篇稿子」那种事实性结论。
    const buildStep = f.tables.action_run_steps.find((s) => s.step_key === 'build')
    expect(buildStep?.attempt).toBe(3)
    expect(String(outcome.humanReason)).toContain('connection reset')
  })
})
