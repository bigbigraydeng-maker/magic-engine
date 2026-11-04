/**
 * `buildContactModel(row, touchpoints, stageMeta)` — 全部 CRM 读路径共用的
 * ContactLike 装配器（今天名单 / 全部客人 / WP3 跟进表 / 未来的员工全表视图）。
 *
 * 抽出来的原因：`today/route.ts` 和 `contacts/route.ts` 各自拼过一份 —— 于是
 * `contacts/route.ts` 少给了 `snoozeUntil` / `automated` / `action`，「全部客人」
 * 表里推迟中的人显示成原分段、群发邮件被当成「我们出手过」、按钮记录被当成
 * 联系记录。两处一致才有意义：分段模块只有一份，喂它的数据形状也只能有一份。
 *
 * 这里只装配形状 —— 不判「谁是自己人」、不算 hot/cold、不排除 staff。那些
 * 由上游先过滤好再喂进来。
 *
 * 与 WP2 的关系：这里的 `automated` 只按 `isAutomatedTouch(source, metadata)`
 * 计算，这是「机器 vs 人」的默认判据。WP2 的 `withHumanReplyCheck` 会在读取
 * 时对 Messenger 出站行覆盖 `metadata.automated=true` 并可能前移 `occurred_at`；
 * 覆盖发生在调用本函数之前（上游把 rows 与 touchpoints 先过一遍），本函数
 * 无需知道那层。
 */

import type { ContactLike, TouchpointLike } from './segments'
import { callStanceFromMetadata, engagementFromMetadata, isUnansweredCall } from './segments'
import { reclassifyStoredOutcome } from './note-parser'
import { isDoNotContact } from './dnc'
import { isAutomatedTouch } from './automated-touch'

/** 联系人行的字段子集——只列本函数用到的列，不锁死取数方式（分页 / 全量 / 未来的按段筛选都能喂进来）。 */
export interface ContactRowLike {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean | null
  snooze_until: string | null
  stage: string | null
}

/** 触点行的字段子集。metadata 是 jsonb，未知键忽略。 */
export interface TouchpointRowLike {
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  source: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
}

/** 阶段配置行的子集（`client_pipeline_stages` 一行）。 */
export interface StageMetaLike {
  label: string
  /** true = 已成交 / 转售后 / 明确停止营销 / 终态；此人不进今天名单。 */
  suppressed: boolean
}

/** metadata 里的 action，两个值以外一律 null——避免 spec 之外的新按钮偷偷影响下游判断。 */
function actionOf(metadata: Record<string, unknown> | null): 'snooze' | 'unsnooze' | null {
  if (!metadata) return null
  if (metadata.action === 'snooze') return 'snooze'
  if (metadata.action === 'unsnooze') return 'unsnooze'
  return null
}

/** 一条触点行 → ContactLike.touchpoints 里的一条（读侧共用）。 */
export function buildTouchpointLike(t: TouchpointRowLike): TouchpointLike {
  const md = t.metadata ?? null
  return {
    channel: t.channel,
    direction: t.direction,
    occurredAt: t.occurred_at,
    // 存量记录的 outcome 要按当前分类规则重判一次；否则新分类只对新笔记生效，被埋掉的人回不来。
    outcome: reclassifyStoredOutcome((md?.outcome as string) ?? null, t.raw) ?? null,
    source: t.source,
    travelWindow: (md?.travel_window as string) ?? null,
    callbackAt: (md?.callback_at as string) ?? null,
    // 邮件打开 / 链接点开 = 行为信号，不是真人消息；分段规则要靠它避开「假装回话了」。
    engagement: engagementFromMetadata(md),
    // 群发 / AI 外呼 / 机器写的自动回复 —— 不算「我们出手」。判据由 automated-touch 统一。
    automated: isAutomatedTouch(t.source, md),
    // 员工按了推迟 / 取消推迟这两个按钮——客人那头什么都没收到，不算联系动作。
    action: actionOf(md),
    // 电话系统记录的外呼没人接：我们没联系上他，不算「我们最后一次出站」。
    unansweredCall: t.channel === 'phone' && t.direction === 'outbound' && isUnansweredCall(md),
    // 通话分析读出的客人表态（改天再说 / 不感兴趣）；分析被驳回的不算。规则 6.5 用。
    callStance: callStanceFromMetadata(md),
  }
}

/**
 * 一条联系人 + 所有触点 → 一份 ContactLike。
 *
 * `touchpoints` 里可能混着别人的行，本函数按 `contact_id` 过滤；调用方也可以
 * 先分好组再喂进来（`Map<contactId, TouchpointRowLike[]>`），效果一致。
 *
 * 返回的 ContactLike 会喂给 `segmentContact` 与 `dayWorklist`——形状对不上
 * 会静默走进错误分段，测试文件里那 5 处「分段结果」断言就是这一层的守门人。
 */
export function buildContactModel(
  row: ContactRowLike,
  touchpoints: TouchpointRowLike[],
  stageMeta: Map<string, StageMetaLike>,
): ContactLike {
  const own = touchpoints.filter((t) => t.contact_id === row.id)
  const stage = row.stage ? stageMeta.get(row.stage) : undefined

  return {
    id: row.id,
    displayName: row.display_name,
    // 「别再联系」的真相源是不可变的触点：contacts 列写失败过 / 历史导入只写了 outcome。
    // 两种写法都认；判据只有一份见 lib/crm/dnc（同时认「人明确纠正过这条判错了」）。
    doNotContact: isDoNotContact(
      row.do_not_contact === true,
      own.map((t) => ({
        outcome: (t.metadata?.outcome as string) ?? null,
        flagged: t.metadata?.do_not_contact === true,
        occurredAt: t.occurred_at,
      })),
    ),
    stageSuppressed: stage?.suppressed ?? false,
    stageLabel: stage?.label ?? null,
    snoozeUntil: row.snooze_until,
    touchpoints: own.map(buildTouchpointLike),
    // 这个人实际能怎么被联系到——决定「建议用哪个渠道」落哪。
    // 私信能力看有没有 messenger 触点：有触点就说明那条线是通的。
    hasPhone: !!row.primary_phone,
    hasEmail: !!row.primary_email,
    hasMessenger: own.some((t) => t.channel === 'messenger'),
  }
}
