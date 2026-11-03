/** 广告健康页「广告下一步」合并卡 —— 只读视图类型。 */

export type AdsNextStepRow<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unreadable' }

/** 非内部账号：不读 portfolio_diagnoses，固定中性文案（不是「没有红灯」）。 */
export type HealthRedLightsView =
  | AdsNextStepRow<{ readonly items: readonly string[] }>
  | { readonly kind: 'staff_only' }

export interface AdsNextStepPendingItem {
  readonly summary: string
  readonly href: string
}

export interface AdsNextStepView {
  readonly healthRedLights: HealthRedLightsView
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
