/**
 * 今日待办里的「公司回信确认收到款、但系统没法自动记成交」（2026-10-04，邮箱付款识别）。
 *
 * 为什么要有它：识别器每天读 info@ 已发邮件，证据齐全的自动记成交；认出了「款已收到」
 * 却缺金额 / 有取消字样 / 疑似已有成交的，数据库写不进去（成交必须有金额），如果只留在
 * 运行日志里，这些真实付款就死在日志里（CLAUDE.md §3：发现不许死在日志里）。
 *
 * 数据来源：`conversion-daily-pipeline` 最近一次跑完的运行记录里 `summary.payments`。
 * 拉模式——不依赖事件送达。只展示**最近一次**运行的结果（识别窗口是滚动 8 天，同一封信
 * 每天都会被重新识别，取最新一次就是当前还没处理掉的）。文案不带任何客人姓名/邮箱。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

const REASON_LABEL: Record<string, string> = {
  amount_missing: '邮件里没写金额',
  amount_ambiguous: '邮件里金额不止一个',
  amount_no_currency: '看不出是哪种货币',
  amount_unsupported_currency: '货币系统不支持',
  duplicate_suspected: '这位客人已经有成交记录',
  cancel_words_in_thread: '往来里出现了取消/退款字样',
  previously_rejected: '这位客人的成交之前被人拒绝过',
  do_not_contact: '客人已标记拒联',
  auto_cap_reached: '这次自动发送已到上限',
  no_match_key: '没有可用的邮箱/电话',
  intake_rejected: '系统校验没通过',
  mail_text_unreadable: '邮件全文读不出来',
  multiple_recipients: '邮件发给了多个人',
}

type NeedsHuman = { messageId?: unknown; reason?: unknown }

export async function pushPaymentEmailNeedsHumanItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at, status')
    .eq('job_name', 'conversion-daily-pipeline')
    .eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  // 取最近一次**带 payments 段**的运行（旧的运行记录没有这一段）。
  for (const run of (data ?? []) as Array<{ summary?: { payments?: { ok?: boolean; summary?: unknown } } | null }>) {
    const perClient = run.summary?.payments?.ok === true ? run.summary.payments.summary : null
    if (!perClient || typeof perClient !== 'object') continue
    for (const [clientId, entry] of Object.entries(perClient as Record<string, unknown>)) {
      const list = (entry as { needsHuman?: unknown } | null)?.needsHuman
      if (!Array.isArray(list) || list.length === 0) continue
      const counts = new Map<string, number>()
      for (const n of list as NeedsHuman[]) {
        const key = typeof n.reason === 'string' ? n.reason : 'unknown'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const breakdown = [...counts.entries()]
        .map(([k, n]) => `${REASON_LABEL[k] ?? '其他原因'} ${n} 封`)
        .join('、')
      items.push({
        kind: 'payment_email_needs_human',
        client_name: clientNames.get(clientId)?.name ?? '客户',
        client_id: clientId,
        what:
          `公司回信里有 ${list.length} 封像是「已收到客人付款」的邮件，系统没法自动记成交（${breakdown}）。` +
          '记不进去的成交，广告平台就学不到「谁真掏了钱」。',
        how:
          '打开 info@ 邮箱「已发送」，找最近 8 天里写着 payment/deposit received 的回信，核对客人确实付了款、金额多少（金额看发票）；' +
          '确认是真成交的，在成交审核页手动录入并告诉广告平台。',
        href: `https://app.magicengine.com.au/dashboard/conversions?client=${clientId}`,
      })
    }
    return
  }
}
