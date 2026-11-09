/**
 * 广告账户「熔断状态」查询模块。
 *
 * 为什么是派生态，而不是在账户表上存一列 `is_tripped`：
 *   熔断的解除有两种途径 —— 非 sticky 靠 24 小时自然过期，sticky 靠人写 release 行。
 *   如果存一列，就必须有人（cron / worker）在过期时刻去把它翻回 false。
 *   但本系统**没有任何自动 release 写入者**：没有 cron、没有 worker 去写 release 行。
 *   所以「是否熔断」只能由事件表在读取时现算，否则那一列会永远停在 true。
 *
 * 为什么没有自动 release 写入者：
 *   解除熔断是一个需要人判断的动作（PM 确认问题已修复）。系统刻意不自动写 release，
 *   非 sticky 的过期完全由判据里的时间比较承担，不需要任何写入。
 *
 * 为什么 `facts:` 和 `circuit:` 两个前缀必须分开：
 *   真熔断（reason 以 `circuit:` 开头）和「查询自己炸了」（`facts:circuit_query_failed`）
 *   是两件完全不同的事。查询失败时我们 fail closed（tripped: true），
 *   但如果 reason 也写成 `circuit:` 前缀，那么哪天这条 SQL 挂了，
 *   广告自治会整个哑掉，而人看到的只有一堆「熔断中」，没人知道根因是查询失败。
 *   分开前缀，调用方才能把「真的熔断了」和「读不到」区别对待。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 24 小时 —— 非 sticky trip 的自然过期窗口。 */
export const CIRCUIT_NON_STICKY_TTL_MS = 24 * 60 * 60 * 1000

export interface CircuitState {
  /** 现在是不是处于熔断中。 */
  readonly tripped: boolean
  /**
   * 为什么。`tripped === false` 时为 null。
   * 多条未解 trip 时取**最新那条**（按 created_at DESC, seq DESC）的 reason。
   */
  readonly reason: string | null
  /** 未解的 trip 里有没有 sticky 的（有 → 必须人解，时间过期没用）。 */
  readonly sticky: boolean
  /** 未解 trip 的条数（给待办文案用）。 */
  readonly openTripCount: number
  /**
   * 🔴 查询**自身**失败时的错误原文；查成功为 null。
   * 调用方必须把它跟「真的熔断了」分开处理：
   * 真熔断 → reason 用 `circuit:` 前缀；查询自己炸了 → 用 `facts:circuit_query_failed` 前缀。
   * 否则哪天这条 SQL 挂了，广告自治整个哑掉，而看到的只有一堆「熔断中」，没人知道根因。
   */
  readonly queryError: string | null
}

/** 事件表里我们关心的字段。 */
interface CircuitEventRow {
  id: string
  kind: string
  trip_event_id: string | null
  reason: string
  sticky: boolean
  created_at: string
  seq: number
}

/** 查询失败时的 fail-closed 返回值。 */
function queryFailedState(message: string): CircuitState {
  return {
    tripped: true,
    reason: 'facts:circuit_query_failed',
    sticky: false,
    openTripCount: 0,
    queryError: message,
  }
}

/** 没有熔断时的返回值。 */
function notTrippedState(): CircuitState {
  return {
    tripped: false,
    reason: null,
    sticky: false,
    openTripCount: 0,
    queryError: null,
  }
}

export async function readCircuitState(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  now?: Date,
): Promise<CircuitState> {
  const at = now ?? new Date()
  const cutoff = new Date(at.getTime() - CIRCUIT_NON_STICKY_TTL_MS).toISOString()

  // ① 只取**可能还算熔断**的 trip：sticky 的（时间对它无效）+ 24h 内的。
  //
  // 🔴 为什么不是「取最近 N 条全部事件再在内存里筛」：那种写法要靠一个窗口上限
  //    （`.limit(N)`），而窗口上限在安全闸上是 **fail-open** —— 一条未解的 sticky trip
  //    只要掉到窗口外，就会被算成「没熔断」，而且静默。这正是 WP2 遗留缺陷
  //    #1994 里 `envelope-facts.ts` 那个 `limit(4000)` 的同一个形状：
  //    **把「窗口外有一条」静默变成「没有」。**
  //
  //    改成把判据推进 SQL 之后，结果集天然很小（未解 sticky + 24h 内的 trip），
  //    而且它增长的方向是 fail-**closed** 的：未解 trip 越多，越算熔断。
  const { data: trips, error: tripError } = await sb
    .from('ads_circuit_events')
    .select('id, kind, trip_event_id, reason, sticky, created_at, seq')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('kind', 'trip')
    .or(`sticky.eq.true,created_at.gt.${cutoff}`)
    .order('created_at', { ascending: false })
    .order('seq', { ascending: false })

  if (tripError) return queryFailedState(tripError.message)

  const candidates = (trips ?? []) as CircuitEventRow[]
  if (candidates.length === 0) return notTrippedState()

  // ② 只查这几条 trip 有没有被 release。结果集同样有界。
  const { data: releases, error: releaseError } = await sb
    .from('ads_circuit_events')
    .select('trip_event_id')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('kind', 'release')
    .in('trip_event_id', candidates.map((row) => row.id))

  if (releaseError) return queryFailedState(releaseError.message)

  const releasedTripIds = new Set(
    ((releases ?? []) as Array<{ trip_event_id: string | null }>)
      .map((row) => row.trip_event_id)
      .filter((id): id is string => id !== null),
  )

  const open = candidates.filter((row) => !releasedTripIds.has(row.id))
  if (open.length === 0) return notTrippedState()

  // candidates 已按 created_at DESC, seq DESC 排好，filter 保持原顺序，
  // 所以第一条就是最新那条未解 trip。
  return {
    tripped: true,
    reason: open[0].reason,
    sticky: open.some((row) => row.sticky === true),
    openTripCount: open.length,
    queryError: null,
  }
}

/** `listActiveCircuitTrips` 一次事件行，多带 client_id / ad_account_id 用来分组。 */
interface GlobalCircuitEventRow extends CircuitEventRow {
  client_id: string
  ad_account_id: string
}

/** 现在处于熔断中的一个 (客户, 账户)。 */
export interface ActiveCircuitTrip {
  readonly clientId: string
  readonly adAccountId: string
  /** 最新那条未解 trip 的 reason（同 `CircuitState.reason` 的判据）。 */
  readonly reason: string
  readonly sticky: boolean
  readonly openTripCount: number
}

/**
 * 列出**全部**客户里现在处于熔断中的 (客户, 账户)，给 pm-todo 用。
 *
 * 跟 `readCircuitState` 判据完全一致（同一套 sticky-or-24h 窗口 + release
 * 反查），区别只是不按单个 `(client_id, ad_account_id)` 过滤，一次查出全表。
 *
 * 🔴 **查询失败直接 throw，不吞掉、不当成"没有熔断"。** 这跟 `readCircuitState`
 *    的 fail-closed 方向一致，只是表现形式不同：`readCircuitState` 服务 Kernel
 *    授权判断，读不到必须"当成熔断"（拒绝动作是安全的默认）；这里服务的是
 *    pm-todo 展示，没有"默认值"这个概念可用——展示层读不到就该让调用方的
 *    错误处理接住（`manual-items.ts` 里每个 pusher 都包了 `.catch` 记日志，
 *    不会因为这一条报错就打断其它待办），不能悄悄显示"当前没有熔断"，
 *    那会让真正被熔断冻住的客户从 PM 眼前消失。
 */
export async function listActiveCircuitTrips(
  sb: SupabaseClient,
  now?: Date,
): Promise<readonly ActiveCircuitTrip[]> {
  const at = now ?? new Date()
  const cutoff = new Date(at.getTime() - CIRCUIT_NON_STICKY_TTL_MS).toISOString()

  const { data: trips, error: tripError } = await sb
    .from('ads_circuit_events')
    .select('id, kind, trip_event_id, reason, sticky, created_at, seq, client_id, ad_account_id')
    .eq('kind', 'trip')
    .or(`sticky.eq.true,created_at.gt.${cutoff}`)
    .order('created_at', { ascending: false })
    .order('seq', { ascending: false })

  if (tripError) throw new Error(`ads_circuit_events（trip）读取失败：${tripError.message}`)

  const candidates = (trips ?? []) as GlobalCircuitEventRow[]
  if (candidates.length === 0) return []

  const { data: releases, error: releaseError } = await sb
    .from('ads_circuit_events')
    .select('trip_event_id')
    .eq('kind', 'release')
    .in('trip_event_id', candidates.map((row) => row.id))

  if (releaseError) throw new Error(`ads_circuit_events（release）读取失败：${releaseError.message}`)

  const releasedTripIds = new Set(
    ((releases ?? []) as Array<{ trip_event_id: string | null }>)
      .map((row) => row.trip_event_id)
      .filter((id): id is string => id !== null),
  )

  const open = candidates.filter((row) => !releasedTripIds.has(row.id))

  // 按 (client_id, ad_account_id) 分组。candidates 已按 created_at DESC, seq DESC
  // 排好，同一组里第一次遇到的行就是那组最新的一条。
  const groups = new Map<string, GlobalCircuitEventRow[]>()
  for (const row of open) {
    const key = `${row.client_id}\u0000${row.ad_account_id}`
    const arr = groups.get(key)
    if (arr) arr.push(row)
    else groups.set(key, [row])
  }

  return Array.from(groups.values()).map((rows) => ({
    clientId: rows[0].client_id,
    adAccountId: rows[0].ad_account_id,
    reason: rows[0].reason,
    sticky: rows.some((row) => row.sticky === true),
    openTripCount: rows.length,
  }))
}
