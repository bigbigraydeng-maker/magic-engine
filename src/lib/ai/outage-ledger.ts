/**
 * 「AI 供应商账户断电」的落地与读取。
 *
 * WHY 要落库
 * ---------
 * 2026-09-20 的断电发生在 18:01 (UTC) 某个 cron 里，而下发今日待办的进程 19:01 才跑
 * —— 两个进程之间没有任何东西能把这件事传过去。不落库 = 等于没发生。
 *
 * WHY 是「按天一行的事件记录」而不是「当前活跃告警 + resolved_at」
 * ---------------------------------------------------------------
 * 🔴 魏征 2026-09-23 复审抓到的致命点：`pm-daily-todo` 的调度是 `0 19 * * 0-4`
 *    （render.yaml:723 —— **一天一次，而且只有周日到周四**）。9/20 那次断电只持续
 *    70 分钟。如果告警查的是「现在还没恢复的行」，充完钱一恢复就查不到了 ——
 *    **PM 永远不会知道昨天有 70 分钟全站 AI 在空跑**。这套方案本来是为了修
 *    「坏了没人知道」，按那种写法它自己也报不出来。
 *
 *    所以这里查的是「最近 N 天**出现过**」，不是「现在还坏着」。代价是恢复之后
 *    还会多报一天，那是**正确方向的代价**：宁可多说一次「昨天断过」，
 *    也不能让一次真实断电悄悄过去。
 *
 * 顺带省掉了「检测恢复」那条路径 —— 而那条路径恰恰是最会骗人的：拦截点在
 * Cloudflare AI Gateway 之后，一次 200 可能只是网关缓存命中，证明不了账户真的恢复了。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProviderFailureKind } from './provider-failure'

/**
 * 读写都走**窄函数接口**，生产传 supabase 实现、测试传假函数。
 *
 * 这么拆是跟 `cron/health.ts` 的 `DownstreamProber` 同一条理由（那份注释写得很清楚）：
 * `SupabaseClient` 的类型体过于庞大，测试里造一个满足它整套类型的假客户端
 * 很难做到形状一致，走强转硬糊会让 fixture 悄悄漂移
 * （memory: as-unknown-as-hides-shape-mismatch）。窄接口完全绕开这个问题。
 */
export interface OutageWriteResult {
  error: { message: string } | null
}
export type OutageWriter = (row: OutageRowInsert) => Promise<OutageWriteResult>

export interface OutageReadResult {
  rows: OutageRow[] | null
  error: { message: string } | null
}
export type OutageReader = (sinceDate: string) => Promise<OutageReadResult>

export interface OutageRowInsert {
  provider: string
  reason: string
  outage_date: string
  detail: string
  last_seen_at: string
  /**
   * 🔴 故意**没有** `first_seen_at`。
   *
   * upsert 的 `ON CONFLICT DO UPDATE` 会把传进去的每一列都写一遍 ——
   * 把它一起传进去，同一天第二次命中就会把「第一次是什么时候」改成「最近一次」，
   * 这个列名就开始说谎了（子牙 2026-09-23 实施后复审）。
   * 表上有 `default now()`：insert 时走默认，冲突时因为不在列清单里自然保留。
   */
}

export const PROVIDER_OUTAGES_TABLE = 'provider_outages'

/**
 * 同一个 provider + reason，本进程内多久最多写一次。
 *
 * 断电期间每一次 AI 调用都会命中这里（openai SDK 默认 maxRetries=2，
 * 一次逻辑调用最多 3 次 fetch），不节流会把表写爆。
 *
 * 🔴 因为有节流、且生产是多进程，**表里的行数永远不代表「影响了多少次调用」**，
 *    任何情况下都不许把它当次数报给 PM
 *    （memory: never-report-sampled-estimate-as-a-number）。
 */
const WRITE_THROTTLE_MS = 5 * 60 * 1000

/** key = `${provider}::${reason}` → 上次写库的时刻。模块级，随进程存活。 */
const lastWriteAt = new Map<string, number>()

/** 只有这几类值得落库 —— 重试一万次也不会好的那几种。 */
const RECORDABLE: ReadonlySet<ProviderFailureKind> = new Set<ProviderFailureKind>([
  'account_exhausted',
  'credential_invalid',
  'gateway_auth_failed',
])

export function isRecordable(kind: ProviderFailureKind): boolean {
  return RECORDABLE.has(kind)
}

/** UTC 日历天，YYYY-MM-DD。 */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** 测试用：清掉进程内节流状态。 */
export function resetOutageThrottle(): void {
  lastWriteAt.clear()
}

/**
 * 该不该现在写一次。节流是「同一 provider + reason」维度的，
 * 不同原因（没钱 vs 钥匙不认）互不影响 —— 它们要 PM 去的是不同的后台。
 */
export function shouldWriteNow(provider: string, reason: string, now: Date): boolean {
  const key = `${provider}::${reason}`
  const prev = lastWriteAt.get(key)
  if (prev !== undefined && now.getTime() - prev < WRITE_THROTTLE_MS) return false
  lastWriteAt.set(key, now.getTime())
  return true
}

export interface OutageWrite {
  provider: string
  reason: ProviderFailureKind
  detail: string
  now: Date
}

/**
 * 落一条（同一天同一原因只会有一行，靠表上的唯一约束 + upsert 收敛）。
 *
 * 🔴 **绝不向调用方抛**：这条路跑在每一次 AI 调用的失败分支上，
 *    告警写不进去不能反过来把业务调用也弄挂。
 * 🔴 但**也绝不静默**：`const { error } = await ...`，非空就 console.error。
 *    只解构 data 不看 error 正是 run-logger.ts 头注点名的那个写法
 *    （memory: monitoring-writer-silent-failure-inverts-health-check ——
 *    监控数据源写入方静默失败时，健康检查不是失灵，是**主动报平安**）。
 *    光 console.error 还不够，所以读的那一侧另有兜底自检：读不出这张表时会下发
 *    一条 `ai_alerting_broken`（见 pm-todo/manual-items.ts 的 buildProviderOutageItems）。
 */
export async function recordProviderOutage(
  write: OutageWriter,
  w: OutageWrite,
): Promise<void> {
  const nowIso = w.now.toISOString()
  const { error } = await write({
    provider: w.provider,
    reason: w.reason,
    outage_date: utcDate(w.now),
    detail: w.detail.slice(0, 500),
    last_seen_at: nowIso,
  })
  if (error) {
    console.error(
      `[outage-ledger] 写不进 ${PROVIDER_OUTAGES_TABLE}（告警管道本身坏了）: ${error.message}`,
    )
  }
}

export function makeSupabaseOutageWriter(supabase: SupabaseClient): OutageWriter {
  return async (row: OutageRowInsert): Promise<OutageWriteResult> => {
    // 同一天第二次命中时只更新 last_seen_at / detail，不新增行
    const { error } = await supabase
      .from(PROVIDER_OUTAGES_TABLE)
      .upsert(row, { onConflict: 'provider,reason,outage_date', ignoreDuplicates: false })
    return { error: error ? { message: error.message } : null }
  }
}

export interface OutageRow {
  provider: string
  reason: string
  outage_date: string
  detail: string | null
  first_seen_at: string
  last_seen_at: string
}

/**
 * 读的那一侧必须区分三种状态，不能混成一个 `[]`：
 *   · `{ rows: [...] }`  —— 查到了
 *   · `{ rows: [] }`     —— 查得到、确实没有（合法的「一切正常」）
 *   · `{ error }`        —— **查不了**（表没建 / 权限不对 / 查询挂了）
 *
 * 🔴 第三种绝不能当成第二种。混了的话「告警管道自己坏了」会长得跟
 *    「一切正常」一模一样 —— 正是这张卡存在的原因。
 *    跟 `cron/health.ts` 里 blind vs never_ran 是同一条纪律。
 */
export interface OutageQuery {
  rows: OutageRow[]
  error: string | null
}

export async function readRecentOutages(
  read: OutageReader,
  now: Date,
  windowDays = 14,
): Promise<OutageQuery> {
  const since = new Date(now.getTime() - windowDays * 86_400_000)
  try {
    const { rows, error } = await read(utcDate(since))
    if (error) return { rows: [], error: error.message }
    return { rows: rows ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export function makeSupabaseOutageReader(supabase: SupabaseClient): OutageReader {
  return async (sinceDate: string): Promise<OutageReadResult> => {
    const { data, error } = await supabase
      .from(PROVIDER_OUTAGES_TABLE)
      .select('provider, reason, outage_date, detail, first_seen_at, last_seen_at')
      .gte('outage_date', sinceDate)
      .order('outage_date', { ascending: false })
      .limit(500)
    if (error) return { rows: null, error: { message: error.message } }
    // 一步步收窄，不强转 —— 这是一份已经落库的旧数据，当外部输入处理
    const rows: OutageRow[] = []
    for (const r of Array.isArray(data) ? data : []) {
      if (r === null || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      if (typeof o.provider !== 'string' || typeof o.reason !== 'string') continue
      if (typeof o.outage_date !== 'string') continue
      rows.push({
        provider: o.provider,
        reason: o.reason,
        outage_date: o.outage_date,
        detail: typeof o.detail === 'string' ? o.detail : null,
        first_seen_at: typeof o.first_seen_at === 'string' ? o.first_seen_at : o.outage_date,
        last_seen_at: typeof o.last_seen_at === 'string' ? o.last_seen_at : o.outage_date,
      })
    }
    return { rows, error: null }
  }
}

/**
 * 「连续断了几天」—— 从最近一天往回数**连续**的日历天。
 *
 * 用它而不是「第一次出现到今天的天数差」：9/20 断、9/21 充值、9/25 又断，
 * 第二次必须重新算作第 1 天。按差值算会把它算成第 6 天，
 * 于是第二次断电一声不吭（魏征复审 M6(b) 点名的坑）。
 */
export function streakDays(dates: string[], today: string): number {
  const latest = latestDate(dates, today)
  if (!latest) return 0
  const set = new Set(dates)
  let cursor = latest
  let n = 0
  while (set.has(cursor)) {
    n += 1
    cursor = shiftDate(cursor, -1)
  }
  return n
}

/**
 * 最近一次断电是哪天（不晚于今天）。没有就返回 null。
 *
 * 🔴 这个函数存在的原因是一个差点让整套方案失效的坑（子牙 2026-09-23 实施后复审）：
 *    首版的 `streakDays` 只肯从「今天或昨天」起数，再往前一格没命中就返回 0。
 *    可 `pm-daily-todo` 的调度是 `0 19 * * 0-4`（render.yaml:723），**周五周六不跑**。
 *    于是：周四 20:00 发生一次 70 分钟的断电 → 记在周四那一天 → 下一次跑是周日 →
 *    今天(周日)没有、昨天(周六)也没有 → 算成 0 → **一个字都不报**。
 *    每周有约 72 小时的窗口，短时断电掉进去就永远没人知道 ——
 *    正是这套东西立项要消灭的那件事，换了个形状又长了回来。
 *
 *    所以「有多新鲜」和「连续多久」必须分成两个问题问：
 *    这里回答前者，`streakDays` 回答后者，节流判据两个都要看。
 */
export function latestDate(dates: string[], today: string): string | null {
  let latest: string | null = null
  for (const d of dates) {
    if (d > today) continue // 时钟漂移 / 时区写歪的行，不拿来当「最近一次」
    if (latest === null || d > latest) latest = d
  }
  return latest
}

/** 最近一次断电距今几天（0 = 今天）。没有记录返回 null。 */
export function daysSinceLatest(dates: string[], today: string): number | null {
  const latest = latestDate(dates, today)
  if (!latest) return null
  const ms = new Date(`${today}T00:00:00Z`).getTime() - new Date(`${latest}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

export function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}
