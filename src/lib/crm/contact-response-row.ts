/**
 * CRM 联系人「一行长什么样」—— 列表接口的行装配。
 *
 * 从 `app/api/clients/[id]/crm/contacts/route.ts` 原样搬出来，一行逻辑没改。
 *
 * ## 为什么必须搬
 *
 * 1. **仓库规矩**：可复用逻辑放 `src/lib`，路由层只放 `src/app/api`（CLAUDE.md §7）。
 *    这两个函数被平铺列表、`?view=priority` 分段视图共用，本来就不是路由层的东西，
 *    而那个路由文件已经 678 行。
 * 2. **不搬出来就没法当场试跑**：R7 要把分段真的渲染到页面上，交付前得拿**生产真数据**
 *    喂一遍页面。但列表接口整条路径卡在登录后面，脚本进不去；函数留在路由文件里
 *    又导不出来，脚本就只能自己另写一份「差不多的行」去喂页面 —— 那验的是另一条路，
 *    不是真的那条。2026-09-26 NAL 止血就栽在这上面：我验了「Meta 会放行」，
 *    没验「我们自己的代码会放行」，中间隔着一道闸，改完当场试跑才发现没成。
 *    搬出来之后 `scripts/probe-crm-priority-ui.ts` 调的就是生产同一个函数。
 */

import { buildContactModel } from '@/lib/crm/contact-model'
import { segmentContact, SEGMENT_ACTION_META } from '@/lib/crm/segments'
import { nextActionFor, type IntentLevel } from '@/lib/crm/next-action'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'
import {
  extractCustomColumns,
  type CustomColumnKey,
  type TouchpointForColumn,
} from '@/lib/crm/table-columns'

import { contactCardTitle } from './display-name'
import { isAutomatedTouch } from './automated-touch'

export interface ContactRow {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean
  snooze_until: string | null
  stage: string | null
  first_seen_at: string
  pinned_at: string | null
  important_note: string | null
  important_due_at: string | null
  /**
   * 这条线索当前分给谁跟进 —— `client_portal_users.email` 字面值，null = 还没人管。
   * 2026-10-26 part 2 加字段 + round-robin 自动分配进来；part 3 这里把它向列表 /
   * 抽屉透出来，让员工看得见 + 改得动（issue #3158）。
   */
  assigned_to: string | null
}

export interface TouchRow {
  id: string
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  /** Staff-note write time can differ from the backfilled call time. */
  created_at?: string | null
  summary: string | null
  /** 原话。存量结果值读的时候要靠它重判一次（见 reclassifyStoredOutcome）。 */
  raw: string | null
  metadata: Record<string, unknown> | null
  source: string | null
}

export interface StageRow {
  stage_key: string
  label: string
  marketing_action: string
  is_terminal: boolean
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}


export function stageMetaOf(stageRows: StageRow[]): Map<string, { label: string; suppressed: boolean }> {
  const stageMeta = new Map<string, { label: string; suppressed: boolean }>()
  for (const s of stageRows) {
    stageMeta.set(s.stage_key, {
      label: s.label,
      suppressed: stageSuppressesWorklist(
        isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress',
        s.is_terminal,
      ),
    })
  }
  return stageMeta
}

/** 每人一行的响应形状 —— 平铺列表与 view=priority 共用，两个形状里同一个人长得一模一样。 */
export function responseRowFor(
  c: ContactRow,
  tps: TouchRow[],
  stageMeta: Map<string, { label: string; suppressed: boolean }>,
  model: ReturnType<typeof buildContactModel>,
  seg: ReturnType<typeof segmentContact>,
  brief?: { intent: IntentLevel | null; nextAction: string | null; summary?: string | null } | null,
): { row: Record<string, unknown>; custom: Record<CustomColumnKey, string | null> } {
  // 进线时间 = 真实最早一条触点（不是导入日期）；没触点退回 first_seen_at。
  // 最近联系 = 最晚一条触点；0 触点显式 null —— 绝不 fallback last_seen_at
  // （它默认 = 建档时的 NOW()，会假装有过一次根本没发生的沟通）。
  let firstTouch = 0
  let lastTouch = 0
  for (const t of tps) {
    const v = ts(t.occurred_at)
    if (v > 0) {
      if (firstTouch === 0 || v < firstTouch) firstTouch = v
      // 机器发出的邮件（Mailchimp 欢迎信 / 群发）不算「最近联系」：
      // 否则每天早上 8:02 的欢迎信会让昨天进来的新客人被算成「今天已处理」（2026-08-02 同类事故）。
      // 只针对邮件——AI 外呼也标了 automated，但那是一通真电话。
      if (t.channel === 'email' && t.direction === 'outbound' && isAutomatedTouch(t.source, t.metadata)) continue
      if (v > lastTouch) lastTouch = v
    }
  }

  const forColumns: TouchpointForColumn[] = tps.map((t) => ({
    channel: t.channel,
    occurredAt: t.occurred_at,
    metadata: t.metadata,
    source: t.source,
    raw: t.raw,
  }))
  const custom = extractCustomColumns(forColumns)

  return {
    custom,
    row: {
      contactId: c.id,
      name: contactCardTitle(c.display_name),
      firstSeenAt: firstTouch > 0 ? new Date(firstTouch).toISOString() : c.first_seen_at,
      lastTouchAt: lastTouch > 0 ? new Date(lastTouch).toISOString() : null,
      phone: c.primary_phone,
      /**
       * 号码在库里但打不通 —— **两个 CRM 入口必须说同一件事**（Codex 复审 2026-08-16）。
       *
       * 不带的话，同一个已判坏的号在「今天该联系谁」被禁用，切到「全部客人」
       * 展开却照旧能一点就拨。销售会以为其中一边是过时的，而两边他都不再信。
       */
      phoneUnusable: seg.phoneUnusable ?? false,
      /**
       * 被标成「别再联系」—— 页面据此给出**取消**那条路。
       *
       * 今日待办下发的「可能被误判成永久拒联」人工任务，href 指向的正是
       * 「全部客人」这一页（Codex 复审 2026-08-16）。不带这个字段，FDE 照着
       * 任务点进来会发现根本没有任务里说的那个按钮 —— 照着做也做不成
       * 的人工任务，比不下发更糟。用上面 model 已经算好的那份，不重算。
       */
      doNotContact: model.doNotContact,
      email: c.primary_email,
      // 电话邮箱都没有时，页面据此显示「仅 FB 私信」而不是「没留联系方式」。
      hasMessenger: tps.some((t) => t.channel === 'messenger'),
      stage: c.stage,
      // 认不出的 stage_key（配置里删了）显示原值，别留空白。
      stageLabel: c.stage ? (stageMeta.get(c.stage)?.label ?? c.stage) : null,
      // 人工置顶（contacts.pinned_at）。这一轮只读出来给页面显示 / 切换，
      // 排序仍是系统算的 —— 置顶优先排序是下一轮的事。
      pinnedAt: c.pinned_at,
      // 「⭐置顶」附带的原因和到期日（contacts.important_note / important_due_at）。
      // 这一轮只读出来给页面显示，编辑走 PATCH .../important，UI 是下一轮的事。
      important: { note: c.important_note, dueAt: c.important_due_at },
      segment: seg.segment,
      segmentLabel: SEGMENT_ACTION_META[seg.segment].label,
      temperature: seg.temperature,
      /**
       * 这个人该走哪个渠道联系 + 为什么排到这一批 —— PersonDrawer 靠 `suggestedChannel`
       * 决定给哪几个按钮（`drawer-actions.ts`）。子牙 2026-09-28 复审 B2 时查出：
       * 这两个字段 `segmentContact()` 早就算出来了，这里却没往响应行里塞，
       * 「全部客人」页换用 PersonDrawer 后会一路兜底成 'phone'——对一个只有
       * Facebook 私信、没有电话的客人会硬渲染"没打通"这种电话话术按钮。
       */
      suggestedChannel: seg.suggestedChannel,
      reason: seg.reason,
      // 回头客：同一份判据算出来的，原样带出去，列表标小标签、抽屉顶部画横幅都读它。
      returning: seg.returning ?? null,
      // 刚打通聊上、还没记下一步：列表在名字旁标「📞 刚聊过」。
      afterCall: seg.afterCall === true,
      /**
       * 「该做什么」—— 三套状态（阶段 / 冷热 / 意向）合成的那一个概念（PM 2026-10-10）。
       * 列表只画这一行；stage / segment 字段仍返回，抽屉和筛选还在用。
       */
      nextAction: nextActionFor({ seg, intent: brief?.intent ?? null, aiNextAction: brief?.nextAction ?? null }),
      // AI 对这位客人的摘要（有就在「该做什么」列显示，比规则那句「进线了」有用）。
      aiSummary: brief?.summary ?? null,
      intent: brief?.intent ?? null,
      // 跟进人（issue #3158 第二刀 part 3）：null = 未分配。前端据此在列表 /
      // 抽屉里显示「跟进人」一列和下拉；跟 `assigned_to` 列同一个值，不作转换。
      assignedTo: c.assigned_to,
      custom,
    },
  }
}
