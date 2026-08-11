/**
 * 测试夹具：一套最小但**真实**的库内容 + 一个接好线的 Kernel。
 *
 * 刻意不给「一键成功」的快捷方式：每个测试自己决定政策是什么、稿子长什么样，
 * 因为这些正是被测的东西。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionDefinition, CapabilityImplementation } from '../types'
import type { ActionRegistry } from '../registry'
import { createKernelDeps, type KernelDeps } from '../deps'
import { createFakeSupabase, type FakeSupabaseOptions, type Row, type Tables } from './fake-supabase'

export const CLIENT_A = 'client-aaaa'
export const CLIENT_B = 'client-bbbb'
export const GOAL_A = 'goal-aaaa'
export const BRIEF_A = 'brief-aaaa'
export const POST_A = 'post-aaaa'

export const BLOG_DRAFT: Row = {
  id: POST_A,
  client_id: CLIENT_A,
  title: '奥克兰买家最常问的 7 个学区问题',
  meta_title: '学区问答 | Park Homes',
  meta_description: '奥克兰东区学区、通勤与户型的真实取舍。',
  slug: 'auckland-school-zone-faq',
  html_body: '<h2>学区</h2><p>……</p>',
  word_count: 1180,
  schema_json: { '@type': 'FAQPage' },
  geo_html_snapshot: '<section data-geo="1">……</section>',
  status: 'draft',
}

export interface FixtureOptions {
  /** 客户对这个动作的政策。不传 = 库里没有政策行 = 默认 deny。 */
  policy?: Partial<Row> & { action_key: string; mode: string }
  blogPosts?: Row[]
  masterBriefs?: Row[]
  goals?: Row[]
  executionItems?: Row[]
  productionPackages?: Row[]
  extraTables?: Tables
  supabaseOptions?: FakeSupabaseOptions
}

/**
 * 🔴 每个夹具必须拿到自己的一份数据。
 *
 * 首版直接把模块级的 `BLOG_DRAFT` 放进表里，于是一个测试改了正文之后，
 * 后面两个测试拿到的是被改过的稿子 —— 失败信息还指向完全不相干的地方
 * （报「稿子被人改过」而不是「没有品牌底稿」）。测试之间串数据比测试没写还糟。
 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function buildTables(opts: FixtureOptions = {}): Tables {
  return {
    action_runs: [],
    action_run_steps: [],
    authorization_decisions: [],
    client_automation_policies: opts.policy
      ? [
          {
            id: 'policy-1',
            client_id: CLIENT_A,
            policy_version: 1,
            spend_cap_per_run_usd: 0,
            spend_cap_per_period_usd: null,
            spend_cap_period: null,
            decision_ttl_seconds: 900,
            effective_from: '2020-01-01T00:00:00.000Z',
            effective_to: null,
            updated_by: 'test@magiclab',
            ...clone(opts.policy),
          },
        ]
      : [],
    blog_posts: clone(opts.blogPosts ?? [BLOG_DRAFT]),
    master_briefs: clone(opts.masterBriefs ?? [{ id: BRIEF_A, client_id: CLIENT_A }]),
    goals: clone(opts.goals ?? [{ id: GOAL_A, client_id: CLIENT_A, title: '三个月内自然流量翻倍' }]),
    execution_items: clone(opts.executionItems ?? []),
    production_packages: clone(opts.productionPackages ?? []),
    flywheel_actions: [],
    flywheel_outcomes: [],
    ...(opts.extraTables ?? {}),
  }
}

export interface Fixture {
  supabase: SupabaseClient
  tables: Tables
  kernel: KernelDeps
  /** 冻结的时钟 —— 过期 / 退避这些跟时间有关的断言必须可控。 */
  clock: { now: Date }
}

export function makeRegistry(defs: ActionDefinition[]): ActionRegistry {
  const byKey = new Map(defs.map((d) => [d.actionKey as string, d]))
  return {
    has(key: string): key is never {
      return byKey.has(key)
    },
    get(key: string) {
      return byKey.get(key) ?? null
    },
    keys() {
      return Array.from(byKey.keys()) as never[]
    },
  }
}

export function makeFixture(args: {
  registry: ActionRegistry
  capabilities: (sb: SupabaseClient) => Readonly<Record<string, CapabilityImplementation>>
  options?: FixtureOptions
  startAt?: string
  /** 租约时长（秒）。接管测试要把它调小，才能在冻结时钟上把租约推过期。 */
  leaseSeconds?: number
  /** 固定租约身份 —— 用来造「另一个进程」。 */
  ownerId?: string
}): Fixture {
  const tables = buildTables(args.options)
  const clock = { now: new Date(args.startAt ?? '2026-08-08T02:00:00.000Z') }
  // 🔴 假件跟 Kernel 共用同一个冻结时钟 —— 时间只能有一个来源（见 FakeSupabaseOptions.now）
  const supabase = createFakeSupabase(tables, {
    ...(args.options?.supabaseOptions ?? {}),
    now: () => clock.now,
  })
  const kernel = createKernelDeps({
    supabase,
    registry: args.registry,
    capabilities: args.capabilities(supabase),
    workerId: 'test-worker',
    ...(args.leaseSeconds !== undefined ? { leaseSeconds: args.leaseSeconds } : {}),
    ...(args.ownerId !== undefined ? { ownerId: args.ownerId } : {}),
    now: () => clock.now,
    // 测试里不真等 —— 退避的**时长**由 next_attempt_at 断言，不由挂钟断言
    sleep: async () => {},
  })
  return { supabase, tables, kernel, clock }
}

/**
 * 测试用的执行围栏：直接读库里那条 run **当前**的代际。
 *
 * 🔴 生产代码里围栏来自 `kernel_claim_or_takeover_run` 的返回值 ——
 *    那才是「我领到了这一代」的唯一凭据。测试里那些绕过领取、
 *    直接调 `authorizeRun` / `executeAuthorizedRun` 的用例没有领取动作，
 *    所以这里按当前值给一个「有效的围栏」，让它们测的仍是各自那道闸。
 *    专门验证 fencing 的用例（lease-takeover / stale-worker）**不用**这个，
 *    它们手里握的是接管**之前**那一代 —— 那才是要防的东西。
 */
export function liveFence(f: Fixture, runId?: string): { ownerId: string; generation: number } {
  const rows = f.tables.action_runs as Array<Record<string, unknown>>
  const row = runId ? rows.find((r) => r.id === runId) : rows[0]
  if (!row) return { ownerId: 'test-owner', generation: 0 }

  // 🔴 围栏不是凭空来的 —— 生产里它只能来自一次真实的领取，
  //    所以这里也把 run 摆成「我确实持有这一代」的样子（owner + 还没到期的租约）。
  //    不摆的话 `claimed_by` 是 null，而围栏说 owner 是 'test-owner'，
  //    两者对不上 —— 执行中途的所有权复核会当场判成「已经被接管」。
  if (row.claimed_by == null) {
    row.claimed_by = 'test-owner'
    row.claimed_at = f.clock.now.toISOString()
    row.heartbeat_at = row.claimed_at
    row.lease_expires_at = new Date(f.clock.now.getTime() + 3_600_000).toISOString()
  }
  return {
    ownerId: String(row.claimed_by),
    generation: Number(row.claim_generation ?? 0),
  }
}
