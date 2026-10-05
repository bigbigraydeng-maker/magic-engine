/**
 * autonomy_mode ↔ client_automation_policies.mode 同步的**纯判据**。
 *
 * 契约（spec `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md` §4）：
 *
 *   · `ad_strategy_configs.autonomy_mode` 是**意向源**（内部全局管理员在 Settings
 *     面板表达「我想让它自动到什么程度」）；`client_automation_policies.mode` 是
 *     Kernel **唯一认的权威源**（`authorize.ts` 的 `getActivePolicy`）。
 *   · **只允许单向 意向 → 权威。** 反向不允许 —— Kernel 的授权决策是 append-only
 *     的审计记录，不能被面板写入覆盖。
 *   · **Kernel 一行不动**（`authorize.ts` / `gateway.ts` / `store.ts` 都不认识
 *     `autonomy_mode`）。Inngest 事件只当**叫醒铃**，payload 只带 `client_id`；
 *     worker 收到铃一律回库 SELECT 当前值，不信 payload 里的值。
 *   · 只动 `mode` + `updated_by`，**不碰** `spend_cap_*` / `decision_ttl_seconds`。
 *   · `deny` **永不由同步写入**（它是为未来管理员 / 熔断预留的值）；worker 遇到
 *     策略表当前是 `deny` 时**跳过不覆盖**（防御性 SQL 守卫，见 spec §4.6）。
 *   · 幂等键 `(client_id, action_key, ad_strategy_configs.updated_at)`：同一个
 *     `updated_at` 已经同步过就跳过，不重复写策略表。
 *
 * 本文件是**纯模块**：不 import supabase、不 import `@/lib/kernel/**` 的运行时
 * 代码（只取注册表的 `ACTION_KEYS` 常量）、无副作用。所有 I/O 归 worker。
 */

import { ACTION_KEYS } from '@/lib/kernel/registry'

/** 意向源的值域（`ad_strategy_configs.autonomy_mode` 的 CHECK 约束）。 */
export type AutonomyMode = 'observe' | 'bounded_auto'

/** 权威源的值域（`client_automation_policies.mode` 的 CHECK 约束，去掉 `deny`）。 */
export type PolicyMode = 'auto_approve' | 'require_approval'

/** 映射表（spec §4.7）。`deny` 刻意不在值域里。 */
export const AUTONOMY_TO_POLICY_MODE = {
  observe: 'require_approval',
  bounded_auto: 'auto_approve',
} as const satisfies Record<AutonomyMode, PolicyMode>

/** 从 Kernel 注册表动态取全部 `ads.` 开头的动作键（新增广告动作自动纳入同步）。 */
export function listAdsActionKeys(): readonly string[] {
  return ACTION_KEYS.filter((key) => key.startsWith('ads.'))
}

export interface AutonomySyncPlanInput {
  readonly autonomyMode: AutonomyMode
  /** `ad_strategy_configs.updated_at`（ISO 字符串） */
  readonly sourceUpdatedAt: string
  /** action_key → 该键最近一条回执的 source_updated_at（ISO 字符串） */
  readonly lastSynced: ReadonlyMap<string, string>
}

export interface AutonomySyncPlanItem {
  readonly key: string
  readonly mode: PolicyMode
  readonly skip: 'already_synced' | null
}

/**
 * 时间戳比较：`lastSynced >= sourceUpdatedAt` 才算「已同步过」。
 *
 * 🔴 按**时间戳**比，不按字符串比 —— ISO 字符串的字典序在时区偏移不同时会骗人
 *    （`2026-09-25T00:00:00+13:00` 字典序大于 `2026-09-24T23:00:00Z`，但时间上更早）。
 *    任一侧解析出 NaN（脏数据 / 空串）→ 一律当**没同步过**（skip = null），
 *    宁可多写一次幂等 UPDATE，也不要把「读不懂」当成「已经同步」。
 */
function isAlreadySynced(lastSyncedAt: string | undefined, sourceUpdatedAt: string): boolean {
  if (lastSyncedAt === undefined) return false
  const last = Date.parse(lastSyncedAt)
  const source = Date.parse(sourceUpdatedAt)
  if (Number.isNaN(last) || Number.isNaN(source)) return false
  return last >= source
}

/**
 * 算出这一轮要写哪些 `(action_key, mode)`。
 *
 * 每个 `ads.*` 键一条，顺序 = 注册表顺序（稳定，便于测试与回执对账）。
 * `skip = 'already_synced'` 的条目 worker 直接跳过，不写策略表、不写回执。
 */
export function planAutonomySync(input: AutonomySyncPlanInput): AutonomySyncPlanItem[] {
  const mode = AUTONOMY_TO_POLICY_MODE[input.autonomyMode]
  return listAdsActionKeys().map((key) => ({
    key,
    mode,
    skip: isAlreadySynced(input.lastSynced.get(key), input.sourceUpdatedAt)
      ? 'already_synced'
      : null,
  }))
}

/** 写进 client_automation_policies.updated_by 的审计标签：autonomy-sync:<email|unknown>:<sourceUpdatedAt> */
export function syncActorLabel(email: string | null, sourceUpdatedAt: string): string {
  return `autonomy-sync:${email?.trim() || 'unknown'}:${sourceUpdatedAt}`
}
