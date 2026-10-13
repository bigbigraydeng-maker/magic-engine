/**
 * 自主执行看板状态解析（纯模块）。
 *
 * 看板从 flywheel_actions 账本行构建只读卡片：这些行没有对应的执行项（execution item），
 * 过去一律显示为 status: 'completed'，完全忽略了 payload.status。但账本里记录的事情
 * 未必真的发生过——可能是演练（dry-run）、被安全检查拦下、执行失败、被否决，或仍在等待
 * 人工确认。本模块把 payload.status 翻译成诚实的看板状态，并决定某位客户成员能否看到该行。
 *
 * 这里是账本 payload.status 词到看板状态的唯一翻译点，遵循三条规则：
 *   1. 账上没写 status 的记录（多数写入方都不写）沿用原行为显示为已完成 —— 其中诸葛建议、
 *      只开了 PR 的 SEO 修复、未来才发的排期帖其实也没做完，那是另一件事，见台账卡
 *      2026-10-12-execution-board-honest-autonomous-status 的后续；
 *   2. 无法识别的 status 绝不显示为“已完成”，对客户成员直接隐藏，对内部成员标为待确认；
 *   3. 客户成员只看得到真做了的、已提交等上线的、等确认的；其余（未真正完成、执行中或
 *      结果未回写）一律隐藏。
 *
 * 🔴 词表只按状态词做键、不分动作类型：新写入方复用 active / paused / live / executed 这类词
 * 表示别的意思，会直接对客户显示成已完成 —— 新增状态词先来这里登记。
 *
 * 所有 label 都是固定字符串，因此 payload.reason / payload.error / 原始数据库错误
 * 都不可能经由本模块泄漏到页面上。
 */

import type { ExecutionItemStatus } from '@/types/diagnostic'
import type { DraftStatus } from '@/lib/ads-strategy/draft-and-gate'

/** 谁在看板子：内部（全局管理员）还是客户（客户成员、演示 / 试用账号）。见 boardViewerFor。 */
export type BoardViewer = 'internal' | 'client'

export type LedgerDisposition = 'done' | 'in_flight' | 'awaiting_person' | 'settling' | 'not_done'

interface LedgerStatusMeaning {
  readonly disposition: LedgerDisposition
  readonly label: string
}

const LABEL_DONE = '已执行'
const LABEL_AWAITING = '等待确认，确认前不会执行'
const LABEL_SETTLING = '执行中或结果未回写，久未变化需人工核对'
const LABEL_UNCONFIRMED = '结果未确认：处理失败，待人工核对'
export const LABEL_UNKNOWN_STATUS = '状态未识别，未确认完成'

const DRAFT_STATUS_MEANING = {
  awaiting_approval: { disposition: 'awaiting_person', label: LABEL_AWAITING },
  activating: { disposition: 'settling', label: LABEL_SETTLING },
  active: { disposition: 'done', label: LABEL_DONE },
  paused: { disposition: 'done', label: LABEL_DONE },
  // ads.create_ad 被拦时广告其实已经建在 Meta 上（暂停着），所以说「未生效」而不是「未执行」。
  blocked: { disposition: 'not_done', label: '未生效：被安全检查拦下' },
  // 写入成功、回读失败也会记成 failed —— 账上并不知道到底做没做成，不能说「没做」。
  failed: { disposition: 'not_done', label: LABEL_UNCONFIRMED },
  rejected: { disposition: 'not_done', label: '未执行：已被否决' },
  dry_run_logged: { disposition: 'not_done', label: '未执行：仅演练记录' },
} satisfies Record<DraftStatus, LedgerStatusMeaning>

const OTHER_STATUS_MEANING: Record<string, LedgerStatusMeaning> = {
  // ads.reactivate_campaign — src/app/api/clients/[id]/meta-ads/execute/route.ts
  authorized_pending: { disposition: 'settling', label: LABEL_SETTLING },
  executed: { disposition: 'done', label: LABEL_DONE },
  meta_failed: { disposition: 'not_done', label: LABEL_UNCONFIRMED },
  // ads.adjust_bid — src/lib/inngest/functions/ads-campaign-budget.ts 把 Kernel 的结果词原样记成 status
  succeeded: { disposition: 'done', label: LABEL_DONE },
  workflow_failed: { disposition: 'not_done', label: LABEL_UNCONFIRMED },
  dead_letter: { disposition: 'not_done', label: LABEL_UNCONFIRMED },
  denied: { disposition: 'not_done', label: '未执行：未获授权' },
  pending_approval: { disposition: 'awaiting_person', label: LABEL_AWAITING },
  in_progress: { disposition: 'settling', label: LABEL_SETTLING },
  // page upgrade PR — src/lib/cms/github-page-upgrade-publisher.ts / page-upgrade-pr-sync.ts
  pr_open: { disposition: 'in_flight', label: '已提交，等待上线' },
  live: { disposition: 'done', label: LABEL_DONE },
  // 代码里没有写入方；生产库里有早期手写入账的记录用这个词（2026-10-12 查库）。
  completed: { disposition: 'done', label: LABEL_DONE },
}

const STATUS_MEANING: ReadonlyMap<string, LedgerStatusMeaning> = new Map<string, LedgerStatusMeaning>([
  ...Object.entries(OTHER_STATUS_MEANING),
  ...Object.entries(DRAFT_STATUS_MEANING),
])

/** 客户成员能看到的只有：真做了的、已提交等上线的、等确认的。 */
const CLIENT_VISIBLE_DISPOSITIONS: ReadonlySet<LedgerDisposition> = new Set<LedgerDisposition>([
  'done',
  'in_flight',
  'awaiting_person',
])

/**
 * 客户成员看得到的那些状态词 —— 给查询用，让「看不到的记录」在数据库那一步就不占名额
 * （先取 50 条再过滤的话，连着几十条演练记录就能把客户的看板挤空）。
 */
export const CLIENT_VISIBLE_LEDGER_STATUSES: readonly string[] = [...STATUS_MEANING]
  .filter(([, meaning]) => CLIENT_VISIBLE_DISPOSITIONS.has(meaning.disposition))
  .map(([word]) => word)

export interface AutonomousBoardState {
  readonly status: ExecutionItemStatus
  /** 标题后缀用的固定说法；null = 真做完了的记录，标题不加后缀。 */
  readonly label: string | null
  readonly disposition: LedgerDisposition | 'unknown'
}

const BOARD_STATUS: Record<LedgerDisposition, ExecutionItemStatus> = {
  done: 'completed',
  in_flight: 'in_progress',
  awaiting_person: 'pending',
  settling: 'in_progress',
  not_done: 'skipped',
}

/** 返回 null = 这条记录不给这位看的人显示。 */
export function resolveAutonomousBoardState(
  payloadStatus: unknown,
  viewer: BoardViewer,
): AutonomousBoardState | null {
  // 规则 1：账上没写 status 的记录沿用原行为（已完成），对两种查看者都显示。
  if (payloadStatus === undefined || payloadStatus === null) {
    return { status: 'completed', label: null, disposition: 'done' }
  }

  // 规则 2：只有字符串才查表；精确匹配，不 trim、不转小写。
  const meaning =
    typeof payloadStatus === 'string' ? STATUS_MEANING.get(payloadStatus) : undefined

  // 规则 3：无法识别 —— 客户成员隐藏，内部成员标为待确认，绝不显示为已完成。
  if (meaning === undefined) {
    if (viewer === 'client') {
      return null
    }
    return { status: 'pending', label: LABEL_UNKNOWN_STATUS, disposition: 'unknown' }
  }

  // 规则 4：客户成员只看得到真做了的、已提交等上线的、等确认的；其余一律隐藏。
  if (viewer === 'client' && !CLIENT_VISIBLE_DISPOSITIONS.has(meaning.disposition)) {
    return null
  }

  // 规则 5：其余情况按 disposition 映射看板状态；done 不加标题后缀。
  return {
    status: BOARD_STATUS[meaning.disposition],
    label: meaning.disposition === 'done' ? null : meaning.label,
    disposition: meaning.disposition,
  }
}

/**
 * 谁算「内部」：只有全局管理员（tier=admin 且不限定客户）。
 * 受限管理员（演示 / 试用账号，tier 也是 admin 但带 allowedClientId）和客户成员一律按客户看 ——
 * 判错的方向只会是少看，不会是多看。
 */
export function boardViewerFor(access: { tier: string; allowedClientId: string | null }): BoardViewer {
  return access.tier === 'admin' && access.allowedClientId === null ? 'internal' : 'client'
}
