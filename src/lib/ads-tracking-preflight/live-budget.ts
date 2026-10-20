/**
 * 批准那一刻现读「广告账户与付款 / 在投预算」这一道门（平台通用，只读）。
 *
 * 为什么存在：这道门读的是现在在投的预算，存档回执 12 小时就过期，而每天只在新西兰早上 7 点自动刷新一次。
 * 到了晚上，存档已经过期，门判灰、挡批准；唯一的办法是找开发手动触发一次检查——这个入口产品经理够不着。
 * 所以批准 / 看板在需要时现读一次，用的是同一个判灯函数（不另写一套口径）。
 *
 * 🔴 只读：库只 select；Meta 只发 GET；不写运行记录（cron_run_logs）、不发事件、不发布、不扣费。
 * 🔴 永不 reject：出任何问题或超时返回 null——调用方按「想读但没读成」处理，这道门灰，绝不当成绿。
 * 🔴 有总时限，到点真取消：Meta 单个请求最长 15 秒再加一次重试，一个批准请求等不起；到点把底层请求一并 abort，
 *    不留在后台继续跑（否则 Meta 卡住时每个客户会同时挂着好几轮读取）。
 * 🔴 不能被刷：检查清单页面付费客户账号也打得开，刷新一次就读一轮 Meta 会把读取额度耗掉。
 *    readLiveBudgetGateCached 按客户做短时缓存（读成功 60 秒，没读成 10 秒，**都从读完那一刻起算**——超时场景里
 *    从请求开始算会让失败缓存当场失效），同时进来的请求共用同一次读取（读的过程中一直算命中）。
 * 🔴 平台通用：不点名客户；哪些客户配置了追踪检查看 client-config.ts。
 */

import { getTrackingClientConfig } from './client-config'
import { collectBudgetFacts, collectMetaFacts, type LiveReadDeps } from './collect'
import { judgeAccountBilling } from './judge'
import type { TrackingGateReceipt } from './types'

/** 现读的总时限（毫秒）。 */
export const LIVE_BUDGET_DEADLINE_MS = 12_000

export interface LiveBudgetOptions {
  deadlineMs?: number
  /** 单测用：当前时间（毫秒）；缓存的计时用它。默认 Date.now */
  clock?: () => number
}

/** 两个取消信号任一触发就取消（不用 AbortSignal.any，兼容更老的运行时）。导出仅供单测。 */
export function linkSignals(outer: AbortSignal | null | undefined, inner: AbortSignal): AbortSignal {
  if (!outer) return inner
  if (outer.aborted || inner.aborted) {
    const done = new AbortController()
    done.abort()
    return done.signal
  }
  const merged = new AbortController()
  const fire = (): void => merged.abort()
  outer.addEventListener('abort', fire, { once: true })
  inner.addEventListener('abort', fire, { once: true })
  return merged.signal
}

export async function readLiveBudgetGate(
  clientId: string,
  deps: LiveReadDeps,
  options: LiveBudgetOptions = {},
): Promise<TrackingGateReceipt | null> {
  // 到点把底层请求一并取消：包一层 fetch，把我们的取消信号并进每个请求自己的信号
  const controller = new AbortController()
  const cancellableFetch: typeof fetch = (input, init) =>
    // 已经到点取消了就不再发新请求（读取器遇到错误会再试一次，不能让它在取消之后又发出去）
    controller.signal.aborted
      ? Promise.reject(new Error('已超过现读总时限，取消'))
      : deps.fetcher(input, { ...init, signal: linkSignals(init?.signal, controller.signal) })
  const readDeps: LiveReadDeps = { ...deps, fetcher: cancellableFetch }

  const read = (async (): Promise<TrackingGateReceipt | null> => {
    try {
      const cfg = getTrackingClientConfig(clientId)
      if (cfg === null) return null
      // 账户信息（状态 / 付款方式 / 花费上限）和预算（库里的上限 + 线上在投合计）互不依赖，并着读
      const [meta, budget] = await Promise.all([
        collectMetaFacts(clientId, cfg, [], readDeps),
        collectBudgetFacts(clientId, cfg, readDeps),
      ])
      return judgeAccountBilling({ config: cfg, meta: meta.facts, budget: budget.facts })
    } catch {
      return null
    }
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, options.deadlineMs ?? LIVE_BUDGET_DEADLINE_MS)
  })
  try {
    return await Promise.race([read, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const OK_TTL_MS = 60_000
const FAILED_TTL_MS = 10_000

interface CacheEntry {
  /** 读完的时刻（毫秒）；null = 还在读（同时进来的请求共用这一次） */
  settledAt: number | null
  ttlMs: number
  result: Promise<TrackingGateReceipt | null>
}

const cache = new Map<string, CacheEntry>()

/** 单测用：清掉缓存。 */
export function resetLiveBudgetCache(): void {
  cache.clear()
}

/** 同一个客户短时间内只读一次 Meta；读成功的结果留 60 秒，没读成的只留 10 秒——都从读完那一刻起算。 */
export function readLiveBudgetGateCached(
  clientId: string,
  deps: LiveReadDeps,
  options: LiveBudgetOptions = {},
): Promise<TrackingGateReceipt | null> {
  const clock = options.clock ?? Date.now
  const hit = cache.get(clientId)
  if (hit !== undefined && (hit.settledAt === null || clock() - hit.settledAt < hit.ttlMs)) return hit.result

  const entry: CacheEntry = { settledAt: null, ttlMs: OK_TTL_MS, result: readLiveBudgetGate(clientId, deps, options) }
  void entry.result.then(gate => {
    entry.settledAt = clock()
    if (gate === null) entry.ttlMs = FAILED_TTL_MS
  })
  cache.set(clientId, entry)
  return entry.result
}
