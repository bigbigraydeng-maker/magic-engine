/**
 * Facebook 同步连续失败 → 今日待办「需要你动手」（2026-09-26，NAL 事故）。
 *
 * NAL 的 Facebook 主页授权 2026-09-16 下午失效：表单留资同步每小时报 code 190，
 * 私信同步把同一个报错吞成「0 条新对话」，9 天里新私信和新留资都没进 CRM，
 * 报错只躺在运行记录里，没有任何一条路把它端到人面前。铁律 3 下半：只有人能做的事
 * （对这个主页有管理员身份的人重新点一次「连接 Meta」）必须下发成人工任务。
 *
 * 判据：两个同步任务各取最近 FACEBOOK_SYNC_FAILURE_RUNS 轮已结束的运行；某客户在
 * 同一任务的这几轮里**每一轮**都带 error → 下发一条（按客户合并两个任务）。
 *   · 偶发一次超时不打扰人；
 *   · 最近一轮超过 FACEBOOK_SYNC_STALE_HOURS 小时 = 任务自己停了，那由 cron 体检报，这里不报旧问题；
 *   · 主页绑定没核实（skipped = page_not_verified）有自己的待办（page-binding-items.ts），这里不重复。
 *
 * 本文件一行写操作都没有。取数失败直接抛，由调用方 catch（同 pushMailchimpExportItems）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOverlapSkipSummary } from '@/lib/meta/leads-sync-lock'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type FacebookSyncItemKind = 'facebook_sync_failing'

export const FACEBOOK_SYNC_JOBS = [
  { job: 'messenger-sync-hourly', label: '私信同步' },
  { job: 'meta-leads-sync', label: '表单留资同步' },
] as const

/** 连续几轮都失败才下发。 */
export const FACEBOOK_SYNC_FAILURE_RUNS = 3
/** 最近一轮比这更旧 = 任务自己停了（cron 体检会报），这里不重复报旧问题。 */
export const FACEBOOK_SYNC_STALE_HOURS = 6

interface SyncResultRow {
  clientId?: string
  clientName?: string | null
  error?: string
  skipped?: string
}

export interface SyncRunRow {
  finished_at: string | null
  summary: { results?: SyncResultRow[] } | null
}

/**
 * Graph 报的这一次失败，是不是「要人重新授权」那一类。
 *
 * 认三个 Meta 错误码，三个都只有主页管理员重新点一次「连接 Meta」能修：
 *   · 190 —— 令牌失效 / 过期（OAuthException）
 *   · 200 —— 缺权限，或这个令牌对应的人在该主页上没有被批准的角色
 *   ·  10 —— 同类的权限被拒
 * 三种写法都认：`"code":190`、`code=190`、`(#200)`。
 *
 * 🔴 **为什么 200 和 10 是后补上的**（2026-09-26 当场试跑抓到）：
 * 第一版只认 190。拿生产库真实运行记录跑一遍检测器，4 个在失败的客户里有 2 个
 * （Roman HU、East International）报的是 `HTTP 403 code=200 (#200) Requires
 * permission: pages_messaging`，于是被判成「不是授权问题」，卡片写的是
 * 「这条不用你动手，回我一句我去查」—— 可我查完也只能得出「请主页管理员重新
 * 授权」这同一个结论。等于把一件客户能自己修的事，变成一次白跑的往返。
 * 设计复审当时判「200 不算盲区」，前提是没有客户在撞它；真实数据把这个前提推翻了。
 */
const META_AUTH_ERROR_CODES = [190, 200, 10] as const

export function isFacebookAuthError(error: string): boolean {
  if (error.includes('OAuthException')) return true
  return META_AUTH_ERROR_CODES.some(
    (code) =>
      new RegExp(`code"?\\s*[:=]\\s*${code}\\b`).test(error) || error.includes(`(#${code})`),
  )
}

/** 「连接 Meta」按钮只在客户页的设置抽屉 platform 页签里（同 page-binding-items.ts）。 */
function panelHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`
}

function failedIn(run: SyncRunRow, clientId: string): boolean {
  return (run.summary?.results ?? []).some(
    (r) => r.clientId === clientId && !!r.error && r.skipped !== 'page_not_verified',
  )
}

/** 某个任务最近几轮里**每一轮**都失败的客户。runs 按 finished_at 从新到旧。 */
export function consecutivelyFailing(
  runs: SyncRunRow[],
  now: Date,
): Map<string, { clientName: string; error: string }> {
  const out = new Map<string, { clientName: string; error: string }>()
  if (runs.length < FACEBOOK_SYNC_FAILURE_RUNS) return out

  const latest = runs[0]
  const finished = latest.finished_at ? Date.parse(latest.finished_at) : Number.NaN
  const hoursOld = (now.getTime() - finished) / 3_600_000
  if (!(hoursOld <= FACEBOOK_SYNC_STALE_HOURS)) return out

  for (const r of latest.summary?.results ?? []) {
    if (!r.clientId || !r.error || r.skipped === 'page_not_verified') continue
    const clientId = r.clientId
    if (runs.every((run) => failedIn(run, clientId))) {
      out.set(clientId, { clientName: r.clientName ?? '未知客户', error: r.error })
    }
  }
  return out
}

async function loadRuns(supabase: SupabaseClient, job: string): Promise<SyncRunRow[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', job)
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'partial', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(FACEBOOK_SYNC_FAILURE_RUNS + 5)

  if (error) throw new Error(`cron_run_logs query failed (${job}): ${error.message}`)
  return ((data ?? []) as SyncRunRow[])
    .filter((row) => !isOverlapSkipSummary(row.summary))
    .slice(0, FACEBOOK_SYNC_FAILURE_RUNS)
}

export async function pushFacebookSyncFailingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const byClient = new Map<string, { clientName: string; labels: string[]; errors: string[] }>()

  for (const { job, label } of FACEBOOK_SYNC_JOBS) {
    const failing = consecutivelyFailing(await loadRuns(supabase, job), now)
    for (const [clientId, f] of failing) {
      const entry = byClient.get(clientId) ?? { clientName: f.clientName, labels: [], errors: [] }
      entry.labels.push(label)
      entry.errors.push(f.error)
      byClient.set(clientId, entry)
    }
  }

  for (const [clientId, f] of byClient) {
    const auth = f.errors.some(isFacebookAuthError)
    const what = auth
      ? `这个客户的 Facebook ${f.labels.join('和')}已经连续 ${FACEBOOK_SYNC_FAILURE_RUNS} 次失败：主页授权失效了。新私信、新留资现在进不了 CRM，销售看不到这些人，不会自己好`
      : `这个客户的 Facebook ${f.labels.join('和')}已经连续 ${FACEBOOK_SYNC_FAILURE_RUNS} 次失败，新私信、新留资可能进不了 CRM（不是授权问题，原因要我们查）`
    const how = auth
      ? '请对这个 Facebook 主页有「管理员」身份的人先登录 Facebook，再点链接打开这个客户的设置抽屉，在「Facebook 主页」卡片里点「连接 Meta」重新授权一次。授权完等下一个整点：系统会自动把断掉这几天的私信补回 CRM，这条待办也会自己消失'
      : '这条不用你动手 —— 回我一句「查一下 Facebook 同步」我就去看'
    items.push({
      kind: 'facebook_sync_failing',
      client_id: clientId,
      client_name: f.clientName,
      what,
      how,
      href: panelHref(clientId),
    })
  }
}
