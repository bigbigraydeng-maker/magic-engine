/**
 * 记一次「人工接触」(销售手打的一通电话 / 一次接触)。
 *
 * 这是「电话工作台」的写入核心:把销售随手打的一句话变成一条结构化触点,
 * 顺带把 AI 读出来的「别再联系」落到 contacts 上。冷热分级(segments.ts)
 * 全靠触点算,所以这条写入必须稳、必须幂等、必须不漏合规信号。
 *
 * 三审焊死的两条(都在这里落地):
 *   幂等   靠调用方生成的 clientRef 作 source_ref,配合既有
 *          UNIQUE(client_id, source, source_ref) 去重。双击同 clientRef →
 *          命中冲突 → 不重复插。禁 source_ref=null(Postgres NULL 互不冲突)。
 *   DNC    contacts.do_not_contact 列的写入放在触点之后、且「总是执行」——
 *          配合调用方带同 clientRef 重试,保证最终一致(见路由注释)。触点里
 *          metadata.do_not_contact 也存一份,读路径(today)据此派生,列写失败
 *          不再泄漏(真相源 = 不可变的触点)。
 *
 * IDOR 不在这里管:调用方(路由)必须已经用
 * `WHERE id=contactId AND client_id=clientId` 验过这个 contact 属于该 client。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { parseNote, type NoteParse } from '@/lib/crm/note-parser'
import { withStructuredCallback } from '@/lib/crm/callback-pick'

export interface RecordTouchpointInput {
  clientId: string
  /** 调用方必须已验证此 contact 属于 clientId。 */
  contactId: string
  direction: 'inbound' | 'outbound'
  /** 销售手打的原话。空串应由调用方在更早处挡掉(400)。 */
  note: string
  /** 已归一化的发生时间(ISO)。调用方负责默认 now + 未来时间 clamp。 */
  occurredAt: string
  /** 幂等键(调用方生成的 uuid)。作 source_ref。禁空。 */
  clientRef: string
  /** 竞品清洗用的品牌词(客户 brand_aliases);不传则 parseNote 用内置 CTS 词。 */
  brandTerms?: string[]
  /**
   * 客户所在地时区（NZ 客户传 Pacific/Auckland）。解析「周五给报价」这类
   * **相对日期**的下一步时间要靠它 —— 按服务器的 UTC 算，销售晚上记的
   * 「明天上午」会落到他心里的今天，这一笔当场就过期。
   */
  timeZone?: string
  /** contact 现有的 last_seen_at,用于取 max、不把时间往回拨。 */
  currentLastSeenAt?: string | null
  /**
   * 是谁记的这一笔（登录邮箱）。
   *
   * 2026-08-02 之前完全没存 —— 1938 条触点里 0 条留下了记录人，于是销售早上
   * 打开名单，看得到「昨天聊过」却不知道是不是自己聊的，两个人重复打同一个
   * 客户、或者互相以为对方在跟。这是「每天上班接着跟」这件事的地基。
   *
   * 可选：批量记录（群发邮件后一次记 108 人）和历史导入没有这个信息，
   * 不传就留空，页面按「不知道谁跟的」显示，不假装。
   */
  loggedByEmail?: string | null
  /**
   * 已经解析好的结果,给「整批同一句话」的场景用(如群发邮件后一次记 108 人)。
   *
   * 不传就自己解析。批量场景必须传 —— 否则同一句系统文案会被送去 AI 解析
   * 108 次,既慢(每次约 1 秒,整个请求必超时)又白花钱,而且那句话是系统自己
   * 生成的、根本不含客户信息,解析它没有任何意义。
   */
  parsed?: NoteParse
  /**
   * 这一笔不是「聊了什么」，是**销售按了哪个按钮**（目前只有 `'snooze'`）。
   *
   * 为什么必须留这个标记（day-list 的 M2.7a 缺口）：「推迟」改的是 contact 上的
   * `snooze_until`，冻结副本原样带过去，于是冻结版和实时版**双双**判「已排除」，
   * 被名单过滤掉 —— 人点完就消失，正是这套冻结机制要修的那个毛病。
   *
   * 修法不需要加列：推迟本来就写了一笔今天的出站触点，只要能认出「这一笔是
   * 推迟」，`withoutOurActionsSince` 就能在摘掉它的同时把冻结副本上的
   * `snoozeUntil` 一起清掉，人就留在原位变灰。
   *
   * **推迟和取消推迟必须是两个值**（Codex 复审 2026-08-15 第四轮）。
   * 取消推迟时，如果后面那步「把 snooze_until 清空」失败了，而这里已经写下
   * `'snooze'`，读路径会拿它去清冻结副本上**依然有效的旧推迟** ——
   * 一次失败的「叫回来」，刷新后反而把人挪进了今天的名单还标成灰的。
   * 用 `'unsnooze'` 就没这个歧义：它不清任何东西，只表示「这一笔不是联系」。
   *
   * 只标**按钮动作**，不标聊天内容 —— 手打的笔记不带这个字段。
   */
  action?: 'snooze' | 'unsnooze' | null
  /**
   * 销售在「约回电」快捷项里选定的回电时间（ISO，调用方已按客户时区换算并校验过：
   * 不是过去、不超过 60 天，见 lib/crm/callback-pick）。
   * 传了就写成 `metadata.callback_at` + outcome=`callback_set`，并**覆盖** AI 从原话
   * 里读出的时间；「别再联系」/ 坏号码仍然优先。不传 = 照旧只看解析结果。
   */
  callbackAt?: string | null
}

export interface RecordTouchpointResult {
  touchpointId: string | null
  /** true = 这次真插了一条;false = 命中幂等键(重复提交),没重复插。 */
  created: boolean
  parsed: NoteParse
}

function laterIso(a: string | null | undefined, b: string): string {
  if (!a) return b
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta)) return b
  if (Number.isNaN(tb)) return a
  return ta >= tb ? a : b
}

export async function recordManualTouchpoint(
  input: RecordTouchpointInput,
): Promise<RecordTouchpointResult> {
  const { clientId, contactId, direction, note, occurredAt, clientRef, loggedByEmail } = input

  if (!clientRef) {
    // 兜底:调用方本该挡住。没有幂等键绝不写(否则双击必重复)。
    throw new Error('recordManualTouchpoint 需要 clientRef(幂等键)')
  }

  /**
   * **相对日期要按「这通电话是什么时候打的」算，不是按「什么时候录进系统的」**
   * （Codex 复审 2026-08-15 第五轮）。
   *
   * 这个接口本来就支持补记（路由注释写着「补记历史电话是常态」）。补记昨天
   * 那通电话、笔记里写「明天上午再打」—— 不传 `occurredAt` 当基准的话，
   * 「明天」会按今天算，**下一步整整晚一天排上**，而销售以为已经排好了。
   *
   * 时间坏掉时 `new Date()` 兜底：解析器宁可按今天算，也不能拿 Invalid Date
   * 去推日期（那会让整条 callback 变成 null，静悄悄少排一次跟进）。
   */
  const noteBasis = new Date(occurredAt)
  const parsedFromNote =
    input.parsed ??
    (await parseNote(note, {
      brandTerms: input.brandTerms,
      timeZone: input.timeZone,
      now: Number.isNaN(noteBasis.getTime()) ? new Date() : noteBasis,
    }))
  // 销售点按钮选的回电时间是确定的，赢过 AI 从原话里读出来的（原话 raw 仍原样保存）。
  const parsed = withStructuredCallback(parsedFromNote, input.callbackAt)

  // 1) 幂等写触点。ignoreDuplicates → ON CONFLICT DO NOTHING:
  //    命中冲突时 select 返回空,maybeSingle() 得到 null,created=false。
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'phone',
        direction,
        occurred_at: occurredAt,
        summary: parsed.summary,
        raw: note,
        metadata: {
          outcome: parsed.outcome,
          do_not_contact: parsed.do_not_contact,
          travel_window: parsed.travel_window,
          tour_interest: parsed.tour_interest,
          competitor: parsed.competitor,
          callback_at: parsed.callback_at,
          // 谁记的。没有它，销售早上分不清「昨天聊过」是不是自己聊的。
          logged_by: loggedByEmail ?? null,
          // 销售按的是哪个按钮（只有「推迟」会带）。读路径靠它把冻结副本上的
          // snooze_until 一并清掉，人才不会点完就消失。见 RecordTouchpointInput.action。
          action: input.action ?? null,
        },
        source: 'me_manual',
        source_ref: clientRef,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`写触点失败: ${error.message}`)
  }

  const created = data != null

  // 2) 总是更新 contacts(幂等,重试可收敛):
  //    · last_seen_at 取 max —— 补记历史电话不把时间往回拨。
  //    · 解析出「别再联系」→ 置 do_not_contact 列 + reason。
  //    这一步失败即抛(路由返 500),调用方带同 clientRef 重试:第 1 步幂等
  //    跳过重复插、第 2 步再次收敛,最终把合规列补上。
  const patch: Record<string, unknown> = {
    last_seen_at: laterIso(input.currentLastSeenAt, occurredAt),
    updated_at: new Date().toISOString(),
  }
  if (parsed.do_not_contact) {
    patch.do_not_contact = true
    patch.do_not_contact_reason = parsed.summary
  }

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updateErr) {
    throw new Error(`更新联系人失败: ${updateErr.message}`)
  }

  return { touchpointId: data?.id ?? null, created, parsed }
}
