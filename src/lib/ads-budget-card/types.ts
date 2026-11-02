/** One ad set, one new daily budget. The caller does not supply the current budget. */

export interface BudgetOrder {
  readonly adsetId: string
  readonly adAccountId: string
  readonly newDailyBudgetCents: number
  readonly name: string | null
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

export interface BudgetRuntime {
  read(order: BudgetOrder): Promise<BudgetSnapshot>
  write(order: BudgetOrder): Promise<boolean>
  readback(order: BudgetOrder): Promise<number | null>
}
