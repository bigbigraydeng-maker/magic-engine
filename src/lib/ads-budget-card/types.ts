/** One ad set, one new daily budget, tied to one approved prescription. */

export type MetricDirection = 'up' | 'down'

export interface BudgetOrder {
  readonly prescriptionId: string
  readonly adsetId: string
  readonly adAccountId: string
  readonly newDailyBudgetCents: number
  readonly name: string | null
  readonly expectedMetric: string
  readonly direction: MetricDirection
  readonly observationWindowDays: number
}

/** A number is the client's step cap. The other words mean fail closed. */
export type StepRatio = number | 'invalid' | 'unreadable' | 'off'

export interface BudgetSnapshot {
  readonly registeredAccountIds: readonly string[] | null
  readonly accountId: string | null
  readonly adsetId: string | null
  readonly status: string | null
  readonly currentCents: number | null
  readonly name: string | null
  readonly accountCapCents: number | null
  readonly accountLiveCents: number | null
  readonly countedInLive: boolean | null
  readonly otherAccountsLiveCents: number | null
  readonly clientCapCents: number | null
  readonly lifetimeBlocks: boolean
  readonly stepRatio: StepRatio
}

/** Read the ad set and the caps. This object never writes a budget. */
export interface BudgetRuntime {
  read(order: BudgetOrder): Promise<BudgetSnapshot>
}
