/**
 * 「私信同步跑完了」这张条子 —— 私信同步 → 客户需求卡之间的接力信号。
 *
 * ## 这张条子替换掉的那个错判据（2026-09-07 · 修 14 天停更）
 *
 * 原来两件事是 `render.yaml` 里一条 startCommand 里的两条 curl 用 `&&` 串的：
 *
 *     curl 私信同步 && curl 写需求卡
 *
 * 意图是对的 ——「同步没跑成，就别拿半截数据写卡给销售看」。**但 `&&` 守的是
 * curl 的退出码，而 curl 的退出码回答的是「网关有没有在超时前把响应给我」，
 * 不是「同步有没有跑完」。** 两者从 2026-08-17 起开始分家：
 *
 * · 同步的服务端耗时那天从约 25 秒跳到约 140 秒（`leadIntroScanned` 那条新扫描，
 *   见 `lead-intro-backfill.ts`）
 * · 网关在**约 125 秒**掐断连接返 524（实测边界：跟着跑成功的那些，同步耗时
 *   最大 124.5 秒；没跟着跑的，最小 124.98 秒 —— 501 条样本零反例）
 * · `curl -f` 拿到 524 → 退出码 22 → `&&` 短路 → 第二条 curl **一次都没执行**
 * · 而服务端每一轮都跑完了、每一轮都写了运行记录
 *
 * 后果：`conversation_briefs` 整张表从 2026-08-23 00:12 起 14 天没有一行新写入，
 * 销售的客户需求卡停在 8 月 23 号，而监控上「私信同步每小时正常」。
 *
 * ## 现在的判据
 *
 * 同步路由**跑到最后一行**才发这张条子，条子里带的是服务端自己的回执
 * （几个客户、几条消息、失败几个）。响应有没有在网关那条线以内送达客户端，
 * 跟这张条子发不发**完全无关** —— 这正是原来搞错的那件事。
 *
 * 同步中途整个挂掉（读客户名单失败 / 抛异常）→ 走不到发条子那一行 → 卡不会写。
 * 原来那个意图因此被完整保留，只是判据换成了真的。
 */

/** 事件名。云端专属 —— 本机 factory-worker 不消费（见 inngest/client.ts 的一事件一主）。 */
export const MESSENGER_SYNC_COMPLETED_EVENT = 'me/messenger.sync.completed'

/** 写进 `cron_run_logs.job_name` 的名字。清单（CRON_REGISTRY）反过来对账它。 */
export const MESSENGER_BRIEF_JOB = 'messenger-brief-hourly'

/** 同步跑完之后的机器可读回执 —— 也是 Inngest 后台里能直接看懂的那份。 */
export interface MessengerSyncCompletedData extends Record<string, unknown> {
  /** 这一轮同步了几个客户。 */
  readonly clients: number
  /** 拉回来几条对话 / 几条消息 / 几个新人。 */
  readonly conversations: number
  readonly messages: number
  readonly new_contacts: number
  /** 其中失败几个客户（部分失败照旧写卡，跟改造之前的行为一致）。 */
  readonly failed: number
  /** 邮箱那半边整段失败的原因，没失败是 null。它不挡写卡。 */
  readonly mailbox_error: string | null
  readonly completed_at: string
}

/**
 * 条子的 id —— 按**小时**去重。
 *
 * 🔴 别把它当花钱的闸。Inngest 的事件去重窗口只有 24 小时，而且真正防重复写卡的是
 *    `shouldGenerateBrief`（卡比对话新就不重写 + 每条对话每天最多重写 3 次）。
 *    这个 id 只是「同一小时里手动补触发一次同步」不会再触发一整批卡的一层薄防线。
 */
export function syncCompletedEventId(completedAt: Date): string {
  return `messenger-sync-completed-${completedAt.toISOString().slice(0, 13)}`
}

/**
 * 收到的条子是不是我们认识的那张。
 *
 * 🔴 只校验形状，**不校验数字大小**。同步一条消息都没拉到也照样要写卡 ——
 *    卡写的是**已经在库里**的对话，跟这一轮拉没拉到新东西无关。
 *    早先想过「messages === 0 就跳过」，那会让安静的那几个小时一张卡都不出。
 */
export function parseSyncCompleted(
  data: unknown,
): { ok: true; value: MessengerSyncCompletedData } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = data as Record<string, unknown>
  if (typeof d.completed_at !== 'string' || d.completed_at.length === 0) {
    return { ok: false, reason: 'completed_at_missing' }
  }
  for (const k of ['clients', 'conversations', 'messages', 'new_contacts', 'failed'] as const) {
    if (typeof d[k] !== 'number' || !Number.isFinite(d[k] as number)) {
      return { ok: false, reason: `${k}_not_a_number` }
    }
  }
  return { ok: true, value: d as unknown as MessengerSyncCompletedData }
}
