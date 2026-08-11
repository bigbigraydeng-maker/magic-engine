/**
 * Attribution findings that need a person — Issue #859.
 *
 * Split out of `manual-items.ts` rather than appended to it: that file was
 * already 990 lines on main, past the 800-line ceiling in CLAUDE.md §7, and
 * adding a whole lane to it made a standing violation worse. The remaining
 * overage there is pre-existing and refactoring it is not this PR's business.
 * (Codex P1, round 23 on PR #862.)
 *
 * Two lanes, both of which exist because the finding cannot be fixed
 * automatically and must therefore reach a human with what / how / href:
 *
 *   · actions no evaluator can attribute — three causes, three different fixes
 *   · outcome rows no writer can maintain — a decision, never an automatic delete
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  auditOrphanedOutcomes,
  auditUnattributableActions,
  type OrphanedOutcome,
  type UnattributableAction,
} from '@/lib/flywheel/attribution/unattributable-audit'
import type { UnattributableReason } from '@/lib/flywheel/attribution/outcome-identity'
import { daysAgo, type ManualItem } from './manual-items'

/** The kinds this lane emits. Declared here so `manual-items.ts` carries one
 *  line instead of four, and so adding a lane does not touch that file at all. */
export type AttributionItemKind =
  | 'action_unattributable'
  | 'attribution_audit_failed'
  | 'outcome_rows_orphaned'

const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'

const executionHref = (clientId: string): string =>
  `https://app.magicengine.com.au/dashboard/clients/${clientId}/execution`

/**
 * A page-upgrade action waiting this long to go live is stuck, not in flight.
 *
 * Below it there is nothing for anyone to do: the routing returns `scope_skip`
 * only because the page has not been marked live yet, and the moment it is, the
 * next attribution run picks it up on its own. Putting a self-healing state in
 * the 「需要你动手」 lane every day — with a `how` that literally says it will
 * fix itself — trains the reader to skim the list, which costs more than the
 * item is worth. Above it the same state IS a finding: the merge step has
 * stalled and the attribution never happens. (Codex P2, round 17 on PR #862.)
 */
const SCOPE_SKIP_STALE_DAYS = 14

/**
 * Both attribution lanes, each failing independently.
 *
 * One entry point so the caller carries one call rather than two lanes plus two
 * catch blocks — and so a third lane later cannot be added to `manual-items.ts`
 * instead of here.
 */
export async function pushAttributionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientIds: string[],
  nameOf: (id: string) => string,
  now: Date,
): Promise<void> {
  // 承诺了没人能算的指标的动作 —— 归因每 6 小时都会重新发现它们，但计数进不了
  // 告警，只会一遍遍写进开发日志。这正是「发现死在日志里」。
  await pushUnattributableItems(supabase, items, clientIds, nameOf, now).catch((e) => {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[manual-items] 归因黑洞检查失败:', message)
    items.push(auditFailureItem('有没有动作没人能算效果', message))
  })

  // 效果数据挂在没人能维护的指标上 —— 改指标那一刀的副作用。
  // 只报不删：删别人名下的行正是这个 PR 拆掉的那个 bug。
  await pushOrphanedOutcomeItems(supabase, items, clientIds, nameOf).catch((e) => {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[manual-items] 孤儿效果数据检查失败:', message)
    items.push(auditFailureItem('有没有效果数据没人维护', message))
  })
}

/**
 * A failed check is itself a finding.
 *
 * The audits throw on a query failure precisely so that "nothing is wrong" and
 * "we could not check" never look alike; swallowing that into a console.warn
 * undoes the distinction one layer up and the whole detection disappears.
 */
function auditFailureItem(subject: string, message: string): ManualItem {
  return {
    kind: 'attribution_audit_failed',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `「${subject}」这项检查今天没跑成 —— ${message}。不是「今天没问题」，是没查成；真有问题也看不见`,
    how:
      '这条不用你动手 —— 是我们这边查询挂了（多半是表结构或权限变了）。' +
      '回我一句「查不了」我去修。修好之前，这一项当作没查过，别当作没问题',
    href: RENDER_DASHBOARD_URL,
  }
}

/**
 * Actions promising a metric no evaluator can compute.
 *
 * Attribution finds these on every run and can do nothing about them: either
 * the metric's owning evaluator does not load that flywheel, or it loads the
 * action but its scope produces a different set of keys. Left alone they are a
 * silent permanent gap — the action looks executed, and its effect never
 * appears.
 *
 * Grouped by CAUSE, not just by client: the three causes have different fixes,
 * and a note that names the wrong one sends the reader looking in the wrong
 * place — which is the same as not reporting it at all.
 *
 * Deliberately NOT routed through the cron's failure count: this is a standing
 * property of stored rows, so it would pin the daily digest's alarm on forever
 * while carrying no diagnosis (the digest reads error_message, never summary).
 */
async function pushUnattributableItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientIds: string[],
  nameOf: (id: string) => string,
  now: Date,
): Promise<void> {
  const stranded = await auditUnattributableActions(supabase, clientIds)
  if (stranded.length === 0) return

  const groups = groupActionable(stranded, now)

  for (const [key, rows] of Array.from(groups.entries())) {
    const clientId = key.split('::')[0]
    const n = rows.length
    const metrics = Array.from(
      new Set(rows.map((r: UnattributableAction) => r.expected_metric)),
    ).join('、')

    items.push({
      kind: 'action_unattributable',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: describeUnattributable(rows[0].reason, n, metrics, rows, now),
      how: adviseUnattributable(rows[0].reason, rows),
      href: executionHref(clientId),
    })
  }
}

/**
 * 按「客户 × 原因」分组，并丢掉还会自己好的那些。
 *
 * `scope_skip` 只是页面还没标成已上线，下一轮归因自己会接上 —— 每天把它摆到
 * 「需要你动手」里，只会训练人略过整张清单。等超过 SCOPE_SKIP_STALE_DAYS，
 * 它就不再是「在路上」而是「卡住了」，那时候才有人要动手。
 */
function groupActionable(
  stranded: UnattributableAction[],
  now: Date,
): Map<string, UnattributableAction[]> {
  const groups = new Map<string, UnattributableAction[]>()
  for (const row of stranded) {
    if (row.reason === 'scope_skip') {
      const waiting = daysAgo(row.executed_at, now)
      if (waiting === null || waiting < SCOPE_SKIP_STALE_DAYS) continue
    }
    const key = `${row.client_id}::${row.reason}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

/**
 * 效果数据挂在没人能维护的指标上。
 *
 * 触发路径就是我们自己请人做的那件事：「改指标」。改完之后，旧指标那批行
 * 如果属于另一条评估线，就卡住了 —— pass 1 不碰别人名下的行，而那条线又
 * 加载不到这个动作。它们会一直停在最后一次算出来的数上，还继续被当成证据读。
 *
 * 只报不删：删别人名下的行正是这个 PR 拆掉的那个 bug（老代码按动作整删），
 * 换个更窄的条件再加回来只会让同样的错误更难被发现。
 */
async function pushOrphanedOutcomeItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientIds: string[],
  nameOf: (id: string) => string,
): Promise<void> {
  const orphans = await auditOrphanedOutcomes(supabase, clientIds)
  if (orphans.length === 0) return

  const byClient = new Map<string, OrphanedOutcome[]>()
  for (const row of orphans) {
    const list = byClient.get(row.client_id) ?? []
    list.push(row)
    byClient.set(row.client_id, list)
  }

  for (const [clientId, rows] of Array.from(byClient.entries())) {
    const totalRows = rows.reduce((sum: number, r: OrphanedOutcome) => sum + r.rows, 0)
    const metrics = Array.from(new Set(rows.map((r: OrphanedOutcome) => r.metric_key))).join('、')
    items.push({
      kind: 'outcome_rows_orphaned',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `${totalRows} 条效果数据（${metrics}）没人能再更新了 —— 这些动作后来改了` +
        '指标，旧指标那批数就停在改之前那一刻，但报表和学习还在照读。' +
        '数字不会再变，也不会自己消失',
      how:
        '这条不用你动手，但要你拍个板：这些旧数是删掉，还是留着当历史存档？' +
        '回我一句「删掉」或「留着」就行。我不会自己删 —— 删的是另一条线名下的' +
        '数据，这正是这次修的那个老毛病',
      href: executionHref(clientId),
    })
  }
}

function describeUnattributable(
  reason: UnattributableReason,
  n: number,
  metrics: string,
  rows: UnattributableAction[],
  now: Date,
): string {
  const tail = '这些动作会一直显示「已执行」，但永远不会有效果数据'

  if (reason === 'cross_flywheel') {
    const wheels = Array.from(new Set(rows.map((r) => r.flywheel))).join('、')
    return (
      `${n} 个动作挂的效果指标跟它们所在的战线对不上 —— ${wheels} 战线的动作挂了 ${metrics}，` +
      `而这个指标只有搜索后台那条线能算，它又只认 SEO 战线的动作。${tail}`
    )
  }

  if (reason === 'scope_mismatch') {
    return (
      `${n} 个 SEO 动作挂的指标跟它们的量法对不上 —— 挂了 ${metrics}，` +
      `但搜索后台对这类动作只出另一个口径的数（整站 / 单页各算各的）。${tail}`
    )
  }

  const longest = rows.reduce((max: number, r: UnattributableAction) => {
    const d = daysAgo(r.executed_at, now)
    return d !== null && d > max ? d : max
  }, 0)
  return (
    `${n} 个页面升级动作等着上线，最久的已经等了 ${longest} 天 —— 挂的是 ${metrics}，` +
    `但它们一直没标成已上线，搜索后台那条线就整个跳过它们。${tail}`
  )
}

function adviseUnattributable(
  reason: UnattributableReason,
  rows: UnattributableAction[],
): string {
  // 没有改这两个字段的界面，所以别让人去找入口 —— 说清是我们这边的事，
  // 以及具体该改成什么。
  if (reason === 'cross_flywheel') {
    return (
      '这条不用你动手 —— 是我们派活时把指标配到了错的战线。回我一句「改指标」我就去改，' +
      '改完下一轮归因就能算出来。想先看是哪几个动作，点链接进执行看板'
    )
  }

  if (reason === 'scope_mismatch') {
    const swap = Array.from(
      new Set(
        rows
          .filter((r) => r.suggested_metric)
          .map((r) => `${r.expected_metric} → ${r.suggested_metric}`),
      ),
    ).join('；')
    const detail = swap
      ? `具体是把 ${swap} 换过来`
      : '具体换成这类动作真正能拿到的那个口径'
    return (
      `这条不用你动手 —— 战线没配错，是量法配错了：${detail}。` +
      '回我一句「改口径」我就去改。想先看是哪几个动作，点链接进执行看板'
    )
  }

  return (
    `正常情况下这类动作上线那一刻就自动算出来了，所以只有等超过 ${SCOPE_SKIP_STALE_DAYS} 天` +
    '才会捞出来给你看 —— 也就是说合并上线那一步大概率卡住了。回我一句「卡住了」我去查是卡在' +
    '哪一环。想先看是哪几个页面，点链接进执行看板'
  )
}
