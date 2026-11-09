/**
 * Mailchimp 出口结果 tally 的**唯一**事实定义 —— 「这条 key 算不算出了事」和
 * 「用人话怎么说」都只在这里定。
 *
 * tally 由 `lib/meta/leads-sync.ts` 产出，key = `subscribed` / `already_member` /
 * `skipped:<reason>` / `failed:<reason>`，value = 条数。
 *
 * WHY 要有这个文件
 * ----------------
 * 同一份 tally 有两个消费者：日报邮件（`lib/meta/leads-sync-alert.ts`）和
 * PM 今日待办（`lib/pm-todo/manual-items.ts`）。两边各自判「什么算异常」的话，
 * 会出现邮件里报了「12 条没进邮件名单」、PM 打开今日待办却找不到可动手的事
 * （或者反过来）。判据只能有一份。
 *
 * 判「预期内跳过」用**白名单**，不是黑名单：默认必须是**说出来**。Mailchimp
 * 出口连着修了两次静默失败，两次都死在同一句话上 —— 新出现的一种失败没人认得，
 * 于是被默默咽掉。新加的 reason 落到白名单之外会自动进日报（最多吵一次，往
 * `EXPECTED_SKIP_REASONS` 加一行就能压掉）；反过来则是又一次静默断供。
 *
 * 平台边界：这里只描述 provider 结果的词汇表，不含任何客户名 / 行业判断。
 */

/**
 * 「上一轮已经办成了，本轮零 provider 调用」的跳过理由。
 *
 * ⚠️ 这个 key 是**健康信号**，不是故障：稳态下一整轮的 tally 会长成
 * `{ 'skipped:already_synced': 13 }`，`subscribed` / `already_member` 都是 0。
 * 今后任何健康检查**都不得**用「tally 里没有 subscribed / already_member」
 * 当作故障判据 —— 那是正常运行的样子。
 */
export const ALREADY_SYNCED_REASON = 'already_synced'

/**
 * 「本来就不该进名单」的跳过理由 —— 这几种一律不算异常。
 *
 * 共同点：不进名单是**正确结果**，没有任何人需要为此动手。
 */
const EXPECTED_SKIP_REASONS = new Set([
  'no_email', // 表单没留邮箱，本来就进不去名单
  'invalid_email', // 邮箱不成形，provider 侧也收不了
  'explicit_opt_out', // 人在表单里明确勾了不要
  'contact_dnc', // 这个人已被标记免打扰
  'no_audience_config', // 这个客户没开邮件出口（查得到，就是没配）
  'no_audience_id', // 同上，provider 层的说法
  'already_synced', // 上一轮已经办成了，这一轮不用再打 provider —— 不是异常
])

/** tally key → 给 PM 看的人话。认不出的 key 走 `outletGapLabel` 的兜底。 */
const OUTLET_GAP_LABELS: Record<string, string> = {
  'skipped:client_config_read_failed': '读不出这个客户的邮件名单配置',
  'skipped:no_api_key': '名单配好了，但系统没有 Mailchimp 密钥',
  'skipped:bad_api_key_format': 'Mailchimp 密钥格式不对',
  'skipped:dnc_check_failed': '查不到这个人是否免打扰，保险起见没加',
  'skipped:evidence_persist_failed': '同步记录写不进库，保险起见没加',
  'failed:auth': 'Mailchimp 不认这个密钥',
  'failed:audience_not_found': 'Mailchimp 里找不到这个名单',
  'failed:rate_limited': 'Mailchimp 限流，这批没加进去',
  'failed:provider_5xx': 'Mailchimp 自己出错了',
  'failed:timeout': '连 Mailchimp 超时',
  'failed:network_error': '连不上 Mailchimp',
  'failed:invalid_email': 'Mailchimp 说这个邮箱不合法',
  'failed:unexpected_status': 'Mailchimp 返回了没见过的响应',
  'failed:unexpected_exception': '同步这个人时程序自己炸了',
}

/**
 * 这条 tally key 算不算「本该进名单却没进」。
 *
 * `subscribed` / `already_member` 是好结果；`skipped:` 里只有白名单那几种不算；
 * `failed:` 一律算。
 */
export function isOutletGap(key: string): boolean {
  if (key.startsWith('failed:')) return true
  if (!key.startsWith('skipped:')) return false
  return !EXPECTED_SKIP_REASONS.has(key.slice('skipped:'.length))
}

/** 认识的 key 说人话；不认识的**照原样带出来**，绝不咽掉。 */
export function outletGapLabel(key: string): string {
  return OUTLET_GAP_LABELS[key] ?? `邮件名单出口异常（${key}）`
}

/** 一份 tally 里「本该进名单却没进」的总条数。没有就是 0。 */
export function countOutletGaps(tally: Record<string, number> | undefined): number {
  let n = 0
  for (const [key, count] of Object.entries(tally ?? {})) {
    if (count > 0 && isOutletGap(key)) n += count
  }
  return n
}

// ── 「这条已经办完了吗」──────────────────────────────────────────────────────

/**
 * 存在触点 `metadata.mailchimp_result` 里的那份回执。
 *
 * **必须自己声明**：`tagRepair` 不在 `SubscribeMemberResult` 类型里，它是
 * `subscribeMemberEnsuringTag` 在运行时展开进去的，从现有类型推不出来。
 * 而且库里的值什么形状都可能有（历史行、人手改过的行），所以每个字段都当
 * unknown 收。
 */
export interface StoredMailchimpReceipt {
  status?: unknown
  reason?: unknown
  tagRepair?: unknown
}

/**
 * 这条回执算不算「已经办完，本轮可以不用再打 Mailchimp」。
 *
 * 只有两种算办完：
 *   · `subscribed` —— 我们把人加进名单了
 *   · `already_member` **且**来源标签确实落地了（`applied` / `already_tagged`）
 *
 * 其余一律**不算**，照常重跑 —— 这正是 24 小时回看窗口要保住的重试能力：
 *   · `pending`（回执没写完）→ 重跑
 *   · `skipped:*`（缺配置 / 缺邮箱 / DNC 查不到）→ 配置修好后要能自愈
 *   · `failed:*`（含不可重试的 auth / audience_not_found）→ 密钥修好后要能自愈
 *   · `already_member` 但 `tagRepair` 缺失或以 `failed:` 开头 → 归因证据还没落地
 *
 * `not_attempted` 不算办完：它的唯一来源是「调用方压根没给标签名」，把
 * 「没试过」判成「办完了」，正是这条链路 2026-09-06 整月丢归因的那个思维错误。
 *
 * **任何非预期形状（null / 字符串 / 数组 / 缺字段）一律返回 false 且不抛** ——
 * 判不出来就当没办完，宁可多打一次，不可漏一次。
 */
export function isMailchimpSettled(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const receipt = raw as StoredMailchimpReceipt
  if (receipt.status === 'subscribed') return true
  if (receipt.status !== 'already_member') return false
  return receipt.tagRepair === 'applied' || receipt.tagRepair === 'already_tagged'
}
