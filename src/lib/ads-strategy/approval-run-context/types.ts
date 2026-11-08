/**
 * D3/O1 批准页只读上下文：同广告组上次内核动作、读回、72 小时冷却说明。
 * 不改判定与执行，只读 action_runs / action_run_steps。
 */

export const ADS_ENTITY_COOLDOWN_HOURS = 72

export type ReadbackDisplay =
  | 'consistent'
  | 'inconsistent'
  | 'pending'
  | 'unreadable'

export interface LastKernelActionView {
  readonly summary: string
  readonly finishedAt: string
  readonly readback: ReadbackDisplay
}

export type ApprovalContextBlock<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }

export interface CooldownView {
  /** 新西兰时区可读截止时间 */
  readonly untilLabel: string
  readonly untilIso: string
}

export interface AdsetApprovalContext {
  readonly lastOnAdset: ApprovalContextBlock<LastKernelActionView>
  readonly cooldown: ApprovalContextBlock<CooldownView> | { readonly kind: 'clear' }
  /** 当前这条 run 的读回（待批 / 已执行） */
  readonly thisRunReadback: ReadbackDisplay
}

export function readbackDisplayLabel(value: ReadbackDisplay): string {
  switch (value) {
    case 'consistent':
      return '读回一致'
    case 'inconsistent':
      return '读回不一致'
    case 'pending':
      return '还没读回'
    case 'unreadable':
      return '没读到'
    default: {
      const _x: never = value
      return _x
    }
  }
}

export function actionKeySummary(actionKey: string): string {
  switch (actionKey) {
    case 'ads.auto_pause_on_d3':
      return '自动暂停（D3）'
    case 'ads.scale_unit_budget':
      return '加预算（O1）'
    case 'ads.pause_unit':
      return '暂停广告组'
    case 'ads.cut_unit_budget':
      return '降低广告组预算'
    case 'ads.cut_campaign_budget':
      return '降低系列预算'
    case 'ads.pause_campaign':
      return '暂停广告系列'
    default:
      return actionKey.startsWith('ads.') ? '广告动作' : '内核动作'
  }
}
