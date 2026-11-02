/** 广告健康页「广告下一步」合并卡 —— 只读视图类型。 */

export type AdsNextStepRow<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unreadable' }

export interface AdsNextStepPendingItem {
  readonly summary: string
  readonly href: string
}

export interface AdsNextStepView {
  readonly healthRedLights: AdsNextStepRow<{ readonly items: readonly string[] }>
  readonly pendingActions: AdsNextStepRow<{
    readonly count: number
    readonly items: readonly AdsNextStepPendingItem[]
  }>
  readonly prescription: AdsNextStepRow<{
    readonly version: number
    readonly statusLabel: string
    readonly approvedAt: string | null
  }>
}
