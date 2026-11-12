/**
 * 今日待办里的「成交/咨询待核对」（Issue #1397 PR3）。
 *
 * 文案原则（板桥复审的必改项）：
 *   · 不许出现"回写""CAPI""事件"这类内部说法 —— PM 看不懂按下去会发生什么。
 *   · 要说清**按了会怎样、不按会损失什么**，而不只是"有一条待处理"。
 *   · href 直达能动手的那一页，不是 API 地址。
 *
 * 这里是**拉**模式：直接查库里待处理的行，不依赖任何事件送达。
 * 事件丢了、进程崩了，待办照样出得来 —— 管道不许断头。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { isPastEventWindow } from '@/lib/conversions/event-window'
import { sweepPastWindowAll } from '@/lib/conversions/expire-pending'
import { conversionReviewWhat, pastEventWindowCutoffIso } from '@/lib/conversions/review-copy'

/** 一次最多列这么多，免得某天灌进来几百条把今日待办淹掉。 */
const MAX_ITEMS = 20

type PendingRow = {
  id: string
  client_id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_first: string | null
  customer_last: string | null
  amount_minor: number | null
  currency: string | null
  order_ref: string | null
  occurred_at: string
}

type DoubtRow = {
  id: string
  outcome_id: string
  me_sale_outcomes: {
    client_id: string
    customer_first: string | null
    order_ref: string | null
    outcome_kind?: string | null
    lead_stage?: string | null
  } | null
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export async function pushConversionReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  // 过了 7 天的先标成不发送，再列还发得出去的。不标的话，取整后的「7 天前」
  // 会继续出现在邮件里，页面上发送按钮却已经灰了。
  // 原因约束还没更新时，标不发送会失败。失败只记一笔，仍然列出还在窗口内的，
  // 不让整段成交待办从邮件里消失。过期的靠下面的时间条件排除。
  try {
    await sweepPastWindowAll(supabase, now)
  } catch (e) {
    console.warn('[conversion-review] 过期自动标不发送没做成，今天先不把过期的列进待办:', e)
  }

  // ── 待核对的成交/咨询 ────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select(
      'id, client_id, outcome_kind, customer_first, customer_last, ' +
        'amount_minor, currency, order_ref, occurred_at',
    )
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .gte('occurred_at', pastEventWindowCutoffIso(now))
    .order('occurred_at', { ascending: true })
    .limit(MAX_ITEMS)

  if (error) throw new Error(`成交待核对查询失败: ${error.message}`)

  for (const row of (data ?? []) as unknown as PendingRow[]) {
    const clientName = clientNames.get(row.client_id)?.name ?? '客户'
    // 查询已经去掉过期行。这里再挡一次，避免分界线两侧口径漂开。
    if (isPastEventWindow(row.occurred_at, now)) continue
    const copy = conversionReviewWhat(row, now)

    items.push({
      kind: 'conversion_needs_review',
      client_name: clientName,
      client_id: row.client_id,
      what: copy.what,
      how: copy.how,
      // 🔴 必须是绝对网址。相对路径会被 dropBrokenLinks 静默丢掉
      //    （同 `cross_client_leak` 那次事故，见 manual-items.ts:1540）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${row.client_id}&focus=${row.id}`,
    })
  }

  // ── 发出去了但不知道对方收没收 ──────────────────────────────────────
  // 这一档程序绝不会自己重发 —— 重发一次就是永久多记一笔成交，撤不回。
  const { data: doubts, error: doubtErr } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes(client_id, customer_first, order_ref, outcome_kind, lead_stage)')
    .eq('status', 'in_doubt')
    .limit(MAX_ITEMS)

  if (doubtErr) throw new Error(`不确定状态查询失败: ${doubtErr.message}`)

  for (const row of (doubts ?? []) as unknown as DoubtRow[]) {
    const outcome = row.me_sale_outcomes
    if (!outcome) continue
    const clientName = clientNames.get(outcome.client_id)?.name ?? '客户'

    items.push({
      kind: 'conversion_send_in_doubt',
      client_name: clientName,
      client_id: outcome.client_id,
      what:
        (outcome.outcome_kind === 'lead_stage'
          ? `有一条线索阶段事件（客人走到「${outcome.lead_stage ?? '某一档'}」）发给广告平台时断线了，`
          : `有一笔成交${outcome.order_ref ? `（单号 ${outcome.order_ref}）` : ''}发给广告平台时断线了，`) +
        '不确定对方收到没有。系统**不会**自己重发 —— 万一对方其实收到了，重发就等于把同一笔算成两笔，而且撤不回。',
      how:
        '去广告平台后台的事件管理页看一眼这笔在不在：' +
        '在，就点「已确认收到」；不在，就点「重新发送」。',
      // 🔴 必须是绝对网址（见上面同类注释）。
      // 带上 focus=<outcome_id> —— 同客户多条 in_doubt 时，光滚到 "需要你动手"
      // 区块不够，PM 分不清邮件说的是哪一笔。page.tsx 的 focus effect 会用这个
      // id 定位到具体卡片，找不到就静默不动（stuck 空表面上说明已处理完）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${outcome.client_id}&focus=${row.outcome_id}&status=in_doubt`,
    })
  }

  await pushTokenDeadItems(supabase, items, clientNames, now)
}

type AuthFailedRow = {
  id: string
  outcome_id: string
  me_sale_outcomes: { client_id: string; occurred_at: string; review_status: string; redacted_at: string | null } | null
}

/**
 * 已批准、但因**授权失效**发不出去的成交/咨询——按客户合并成一条「需要你动手」。
 *
 * 2026-09-22 起授权失败不再永久作废，而是等令牌修好后由 `writeback-resend-run.ts`
 * 每天自动补发；但「令牌还没修好」这件事之前只写在 cron summary 里，PM 看不见，
 * CTS 19 条就是这样静静过了 7 天窗口的（子牙复审 M2：发现不许死在日志里）。
 * 这里是拉模式：直接查库，不依赖补发步骤有没有跑。
 */
async function pushTokenDeadItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes(client_id, occurred_at, review_status, redacted_at)')
    .eq('status', 'failed')
    .eq('last_error_code', 'auth')
    .limit(200)

  if (error) throw new Error(`授权失效待补发查询失败: ${error.message}`)

  const byClient = new Map<string, { count: number; oldestOccurredAt: string }>()
  for (const row of (data ?? []) as unknown as AuthFailedRow[]) {
    const o = row.me_sale_outcomes
    if (!o || o.review_status !== 'approved' || o.redacted_at) continue
    // 已经过了 7 天的补发步骤会自己判过期，这里只催还救得回来的。
    if (isPastEventWindow(o.occurred_at, now)) continue
    const cur = byClient.get(o.client_id)
    if (!cur) byClient.set(o.client_id, { count: 1, oldestOccurredAt: o.occurred_at })
    else {
      cur.count++
      if (o.occurred_at < cur.oldestOccurredAt) cur.oldestOccurredAt = o.occurred_at
    }
  }

  for (const [clientId, agg] of byClient) {
    const clientName = clientNames.get(clientId)?.name ?? '客户'
    const daysLeft = Math.max(0, 7 - daysAgo(agg.oldestOccurredAt, now))
    items.push({
      kind: 'conversion_capi_token_dead',
      client_name: clientName,
      client_id: clientId,
      what:
        `有 ${agg.count} 条已经批准的成交/咨询发不到广告平台：连接广告平台的授权失效了。` +
        `最早的一条再过 ${daysLeft} 天就超过平台只收 7 天内的限制，到时候这些就永久丢了，` +
        '广告平台会继续找不对的人。',
      how:
        '重新连接一次这个客户的广告平台授权（跟上次令牌过期时同一个步骤）。' +
        '连好之后不用手动补发——系统每天早上会自动把还在 7 天内的补发出去，看板上这些条目会自己消失。',
      // 🔴 必须是绝对网址（见上面同类注释）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${clientId}&status=failed`,
    })
  }
}
